/**
 * Proof-of-work solver.
 *
 * The server hands out a signed salt and a difficulty in leading zero bits.
 * We look for a nonce where sha256("<salt>:<nonce>") starts with that many
 * zero bits. There is no shortcut, so a bot farm pays real CPU per account —
 * which is the whole point — while one honest signup costs a fraction of a
 * second.
 *
 * Only the first 32 bits of the digest are ever needed (the server caps the
 * difficulty at 28), so the compression loop stops as soon as it has them.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const W = new Uint32Array(64)
const block = new Uint8Array(64)
const view = new DataView(block.buffer)
const digits = new Uint8Array(12)

/** First word of sha256(block), where `block` is already padded. */
function firstWord(): number {
  for (let i = 0; i < 16; i++) {
    W[i] = view.getUint32(i << 2)
  }
  for (let i = 16; i < 64; i++) {
    const x = W[i - 15]!
    const y = W[i - 2]!
    const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)
    const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)
    W[i] = (W[i - 16]! + s0 + W[i - 7]! + s1) | 0
  }

  let a = 0x6a09e667
  let b = 0xbb67ae85
  let c = 0x3c6ef372
  let d = 0xa54ff53a
  let e = 0x510e527f
  let f = 0x9b05688c
  let g = 0x1f83d9ab
  let h = 0x5be0cd19

  for (let i = 0; i < 64; i++) {
    const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
    const ch = (e & f) ^ (~e & g)
    const t1 = (h + s1 + ch + K[i]! + W[i]!) | 0
    const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
    const maj = (a & b) ^ (a & c) ^ (b & c)
    const t2 = (s0 + maj) | 0
    h = g
    g = f
    f = e
    e = (d + t1) | 0
    d = c
    c = b
    b = a
    a = (t1 + t2) | 0
  }

  return (0x6a09e667 + a) >>> 0
}

/** Writes "<prefix><nonce>" into `block` with SHA-256 padding applied. */
function layout(prefixLength: number, nonce: number): void {
  let n = nonce
  let count = 0
  if (n === 0) {
    digits[count++] = 48
  }
  while (n > 0) {
    digits[count++] = 48 + (n % 10)
    n = (n - (n % 10)) / 10
  }
  for (let i = 0; i < count; i++) {
    block[prefixLength + i] = digits[count - 1 - i]!
  }

  const length = prefixLength + count
  block[length] = 0x80
  view.setUint32(56, 0)
  view.setUint32(60, length << 3)
}

export type PowRequest = { salt: string; bits: number }
export type PowProgress = { type: 'progress'; hashes: number }
export type PowSolved = { type: 'solved'; nonce: string; hashes: number; ms: number }
export type PowFailed = { type: 'failed'; reason: string }
export type PowMessage = PowProgress | PowSolved | PowFailed

function solve(salt: string, bits: number): void {
  const prefix = new TextEncoder().encode(`${salt}:`)
  if (prefix.length + 12 + 1 > 56) {
    self.postMessage({ type: 'failed', reason: 'challenge too long' } satisfies PowFailed)
    return
  }
  block.fill(0)
  block.set(prefix, 0)

  const shift = 32 - bits
  const started = Date.now()
  let nonce = 0

  for (;;) {
    layout(prefix.length, nonce)
    if (firstWord() >>> shift === 0) {
      self.postMessage({
        type: 'solved',
        nonce: String(nonce),
        hashes: nonce + 1,
        ms: Date.now() - started,
      } satisfies PowSolved)
      return
    }
    nonce++

    // A heartbeat for the progress indicator, cheap enough to be invisible.
    if ((nonce & 0x3fff) === 0) {
      self.postMessage({ type: 'progress', hashes: nonce } satisfies PowProgress)
      // Give up rather than spin forever on an absurd difficulty.
      if (Date.now() - started > 60_000) {
        self.postMessage({ type: 'failed', reason: 'timed out' } satisfies PowFailed)
        return
      }
    }
  }
}

self.onmessage = (event: MessageEvent<PowRequest>) => {
  const { salt, bits } = event.data
  if (typeof salt !== 'string' || !/^[0-9a-f]{32}$/.test(salt)) {
    self.postMessage({ type: 'failed', reason: 'bad salt' } satisfies PowFailed)
    return
  }
  if (!Number.isInteger(bits) || bits < 1 || bits > 30) {
    self.postMessage({ type: 'failed', reason: 'bad difficulty' } satisfies PowFailed)
    return
  }
  solve(salt, bits)
}

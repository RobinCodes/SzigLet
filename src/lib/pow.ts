import type { PowMessage, PowRequest } from './powWorker'

export type Challenge = {
  salt: string
  bits: number
  expires: number
  sig: string
}

export type Solution = Challenge & { nonce: string }

export type SolveOptions = {
  /** Called with a 0–1 estimate so the UI can show honest-looking progress. */
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

/**
 * Solves a challenge in a worker. The expected number of hashes is 2^bits, so
 * progress is reported against that estimate rather than a real percentage.
 */
export function solveChallenge(
  challenge: Challenge,
  { onProgress, signal }: SolveOptions = {},
): Promise<Solution> {
  return new Promise((resolve, reject) => {
    const expected = Math.pow(2, challenge.bits)
    let worker: Worker

    try {
      worker = new Worker(new URL('./powWorker.ts', import.meta.url), { type: 'module' })
    } catch {
      reject(new Error('This browser cannot run the verification step.'))
      return
    }

    const finish = (fn: () => void) => {
      worker.terminate()
      signal?.removeEventListener('abort', onAbort)
      fn()
    }

    const onAbort = () => finish(() => reject(new DOMException('Aborted', 'AbortError')))
    signal?.addEventListener('abort', onAbort, { once: true })

    worker.onmessage = (event: MessageEvent<PowMessage>) => {
      const message = event.data
      if (message.type === 'progress') {
        // Asymptotic: creeps towards 1 without ever claiming to be done.
        onProgress?.(1 - Math.exp(-message.hashes / expected))
        return
      }
      if (message.type === 'solved') {
        onProgress?.(1)
        finish(() => resolve({ ...challenge, nonce: message.nonce }))
        return
      }
      finish(() => reject(new Error(`Verification failed: ${message.reason}`)))
    }

    worker.onerror = () => finish(() => reject(new Error('Verification could not start.')))
    worker.postMessage({ salt: challenge.salt, bits: challenge.bits } satisfies PowRequest)
  })
}

/**
 * Teaches the built service worker what this build consists of.
 *
 *   node scripts/sw-manifest.mjs        (run automatically by "npm run build")
 *
 * Two substitutions into dist/sw.js:
 *
 *   VERSION   a hash of the build output. It names the shell and asset caches,
 *             so a new build gets fresh ones and the old ones are swept up on
 *             activate. It also changes the bytes of sw.js, which is what
 *             makes the browser notice there is an update at all.
 *   PRECACHE  every hashed file under dist/assets. The worker is registered on
 *             `load`, far too late to intercept the requests for the very
 *             JavaScript that drew the page, so without this list a first
 *             visit would cache the HTML and none of the code.
 */
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const swPath = join(dist, 'sw.js')

if (!existsSync(swPath)) {
  console.error('No dist/sw.js. Run "vite build" first.')
  process.exit(1)
}

/** Every file under a dist subdirectory, as absolute URL paths. */
async function collect(relative) {
  const absolute = join(dist, relative)
  if (!existsSync(absolute)) {
    return []
  }
  const out = []
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    const next = posix.join(relative, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await collect(next)))
    } else {
      out.push('/' + next)
    }
  }
  return out
}

const assets = (await collect('assets')).sort()

// The version has to move whenever anything the worker serves moves, including
// index.html — its inline script and script tags are part of the shell.
const html = await readFile(join(dist, 'index.html'))
const version = createHash('sha256')
  .update(html)
  .update(assets.join('\n'))
  .digest('hex')
  .slice(0, 12)

function replaceBlock(source, name, body) {
  const pattern = new RegExp(
    `// sl-${name}:start\\n[\\s\\S]*?// sl-${name}:end`,
  )
  if (!pattern.test(source)) {
    console.error(`dist/sw.js has no "sl-${name}" block to fill in.`)
    process.exit(1)
  }
  return source.replace(pattern, `// sl-${name}:start\n${body}\n// sl-${name}:end`)
}

let sw = await readFile(swPath, 'utf8')
sw = replaceBlock(sw, 'version', `const VERSION = ${JSON.stringify(version)}`)
sw = replaceBlock(
  sw,
  'precache',
  `const PRECACHE = ${JSON.stringify(assets, null, 2)}`,
)
await writeFile(swPath, sw)

console.log(
  `Service worker build ${version}: ${assets.length} asset${assets.length === 1 ? '' : 's'} precached.`,
)

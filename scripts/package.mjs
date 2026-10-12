/**
 * Builds the exact folder that goes into public_html.
 *
 *   npm run package
 *
 * Produces deploy/build/ containing the compiled site, the PHP API and the
 * three .htaccess files, plus deploy/Upload.zip holding the same tree.
 *
 * Upload the zip and extract it server-side. That is not a convenience: file
 * pickers routinely refuse to show dotfiles, and an upload that quietly drops
 * .htaccess leaves the site serving without its rewrite rules or its CSP.
 */
import { cp, mkdir, rm, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { zipDirectory } from './zip.mjs'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'deploy', 'build')

if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.error('No dist/ yet. Run "npm run build" first.')
  process.exit(1)
}

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })

// 1. The compiled front end.
await cp(join(root, 'dist'), out, { recursive: true })

// 2. The API, minus anything that is only useful locally.
await cp(join(root, 'server'), join(out, 'api'), {
  recursive: true,
  filter: (source) => !source.endsWith('router.php') && !source.endsWith('config.php'),
})

// 3. The document-root rules, with the Content Security Policy pinned to the
//    exact inline scripts this build produced.
const html = await readFile(join(root, 'dist', 'index.html'), 'utf8')
const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((body) => body.trim().length > 0)

const hashes = inlineScripts.map(
  (body) => `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`,
)

let htaccess = await readFile(join(root, 'deploy', 'htaccess-root'), 'utf8')
htaccess = htaccess.replace('__INLINE_SCRIPT_HASHES__', hashes.join(' '))
await writeFile(join(out, '.htaccess'), htaccess)

await writeFile(
  join(out, 'UPLOAD-ME.txt'),
  [
    'SzigLet - upload ../Upload.zip to public_html and extract it there.',
    '',
    'This file is for you, not the server: it is deliberately left out of the',
    'zip so it never ends up readable at https://your-domain/UPLOAD-ME.txt',
    '',
    'Then, on the server:',
    '  1. Create a MySQL database and user, and grant that user ALL PRIVILEGES.',
    '  2. Rename  api/app/config.sample.php  to  api/app/config.php',
    '     and fill in the database name, user, password and a random secret.',
    '  3. Set "owner_username" to the name you will register with.',
    '  4. Open https://your-domain/ and create that account first.',
    '',
    'The database tables create themselves on the first request.',
    '',
  ].join('\n'),
)

const zipPath = join(root, 'deploy', 'Upload.zip')
const zipped = await zipDirectory(out, zipPath, { exclude: ['UPLOAD-ME.txt'] })

async function measure(dir) {
  let total = 0
  let count = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      const inner = await measure(path)
      total += inner.total
      count += inner.count
    } else {
      total += (await stat(path)).size
      count += 1
    }
  }
  return { total, count }
}

const { total, count } = await measure(out)
console.log(
  `Content Security Policy pinned to ${hashes.length} inline script${hashes.length === 1 ? '' : 's'}.`,
)
console.log(`\nReady: deploy/build  (${count} files, ${(total / 1024).toFixed(0)} KB)`)
console.log(`       deploy/Upload.zip (${zipped} files, dotfiles included)`)
console.log('\nUpload the zip to public_html and extract it there.\n')

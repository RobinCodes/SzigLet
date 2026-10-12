/**
 * A minimal zip writer, deflate or store, in plain Node.
 *
 * It exists because the upload archive's whole job is to carry the .htaccess
 * files past a file picker that will not show them. A GUI "compress here" can
 * silently skip dotfiles; this walks the tree itself, so it cannot.
 */
import { crc32, deflateRawSync } from 'node:zlib'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

function dosStamp(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

async function walk(dir, base = '') {
  const found = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const name = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      found.push({ name: `${name}/`, directory: true })
      found.push(...(await walk(join(dir, entry.name), name)))
    } else if (entry.isFile()) {
      found.push({ name, path: join(dir, entry.name) })
    }
  }
  return found
}

/**
 * Zips everything inside `dir` — dotfiles included — into `zipPath`.
 * Paths in the archive are relative to `dir`, so extracting into public_html
 * puts every file exactly where it belongs.
 *
 * @param {string} dir
 * @param {string} zipPath
 * @param {{ exclude?: string[] }} options  archive-relative names to leave out
 * @returns {Promise<number>} how many files were written
 */
export async function zipDirectory(dir, zipPath, { exclude = [] } = {}) {
  const skip = new Set(exclude)
  const entries = (await walk(dir)).filter((entry) => !skip.has(entry.name))
  const stamp = dosStamp(new Date())

  const local = []
  const central = []
  let offset = 0

  for (const entry of entries) {
    const raw = entry.directory ? Buffer.alloc(0) : await readFile(entry.path)
    const squeezed = entry.directory ? raw : deflateRawSync(raw, { level: 9 })
    const deflated = squeezed.length < raw.length
    const body = deflated ? squeezed : raw
    const method = deflated ? 8 : 0
    const sum = crc32(raw)
    const name = Buffer.from(entry.name, 'utf8')

    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0, 6)
    header.writeUInt16LE(method, 8)
    header.writeUInt16LE(stamp.time, 10)
    header.writeUInt16LE(stamp.day, 12)
    header.writeUInt32LE(sum, 14)
    header.writeUInt32LE(body.length, 18)
    header.writeUInt32LE(raw.length, 22)
    header.writeUInt16LE(name.length, 26)
    header.writeUInt16LE(0, 28)

    const listing = Buffer.alloc(46)
    listing.writeUInt32LE(0x02014b50, 0)
    listing.writeUInt16LE(0x031e, 4) // made on unix, zip 3.0
    listing.writeUInt16LE(20, 6)
    listing.writeUInt16LE(0, 8)
    listing.writeUInt16LE(method, 10)
    listing.writeUInt16LE(stamp.time, 12)
    listing.writeUInt16LE(stamp.day, 14)
    listing.writeUInt32LE(sum, 16)
    listing.writeUInt32LE(body.length, 20)
    listing.writeUInt32LE(raw.length, 24)
    listing.writeUInt16LE(name.length, 28)
    listing.writeUInt16LE(0, 30)
    listing.writeUInt16LE(0, 32)
    listing.writeUInt16LE(0, 34)
    listing.writeUInt16LE(0, 36)
    // Unix permissions live in the top 16 bits; shifting would overflow int32.
    listing.writeUInt32LE((entry.directory ? 0o40755 : 0o100644) * 0x10000, 38)
    listing.writeUInt32LE(offset, 42)

    local.push(header, name, body)
    central.push(listing, name)
    offset += header.length + name.length + body.length
  }

  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  await writeFile(zipPath, Buffer.concat([...local, directory, end]))
  return entries.filter((entry) => !entry.directory).length
}

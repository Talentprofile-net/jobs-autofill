import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'

export async function extensionIdOf(directory) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
  const identity = manifest.key ? Buffer.from(manifest.key, 'base64') : await realpath(directory)
  return [...createHash('sha256').update(identity).digest('hex').slice(0, 32)]
    .map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)))
    .join('')
}

export async function requireExtensionApis(read, targetId) {
  const page = await read(
    `({ href: location.href, runtime: typeof globalThis.chrome?.runtime, tabs: typeof globalThis.chrome?.tabs })`,
  )
  if (page.runtime !== 'object' || page.tabs !== 'object') {
    throw new Error(`the harness page has no extension APIs: ${JSON.stringify({ targetId, ...page })}`)
  }
}

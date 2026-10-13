import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SOURCE = new URL('..', import.meta.url).pathname

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(ts|svelte)$/.test(entry.name) && !entry.name.endsWith('.spec.ts') ? [path] : []
  })

describe('the extension never writes the TalentProfile profile', () => {
  it('only reads the talentprofile endpoint, so answers typed into an ATS form stay out of the profile', () => {
    const calls = sourceFiles(SOURCE).flatMap((file) =>
      Array.from(readFileSync(file, 'utf8').matchAll(/apiFetch[^(]*\(\s*['"`]([^'"`]*talentprofile[^'"`]*)['"`]\s*,\s*\{\s*method:\s*['"](\w+)['"]/gi)).map((m) => `${m[1]} ${m[2]}`),
    )
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((call) => call.endsWith(' GET'))).toBe(true)
  })
})

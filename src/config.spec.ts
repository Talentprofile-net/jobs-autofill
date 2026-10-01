import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const apiBaseUrl = (env: Record<string, string>): string =>
  spawnSync(process.execPath, ['-e', "import { API_BASE_URL } from './src/config.ts'; process.stdout.write(API_BASE_URL)"], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', ...env },
  }).stdout

describe('api base url', () => {
  it('uses the live backend host when DEV is off', () => {
    expect(apiBaseUrl({})).toBe('https://backend.talentprofile.net')
  })

  it('uses localhost only when DEV is on', () => {
    expect(apiBaseUrl({ DEV: 'true' })).toBe('http://localhost:8083')
  })

  it('lets an explicit build variable override both', () => {
    expect(apiBaseUrl({ DEV: 'true', VITE_API_BASE_URL: 'https://staging.example.invalid' })).toBe(
      'https://staging.example.invalid',
    )
  })
})

import { describe, expect, it } from 'bun:test'

import {
  cancelPermissionIntent,
  handleGrantedOrigins,
  matchIntentFrame,
  PERMISSION_INTENT_KEY,
  PERMISSION_INTENT_TTL_MS,
  recordPermissionIntent,
  takePermissionIntent,
  type IntentStorageArea,
  type PermissionIntent,
} from './permissionIntent'

const makeArea = (): IntentStorageArea & { raw: Map<string, unknown> } => {
  const raw = new Map<string, unknown>()
  return {
    get: async (key) => (raw.has(key) ? { [key]: structuredClone(raw.get(key)) } : {}),
    raw,
    set: async (items) => {
      for (const [key, value] of Object.entries(items)) raw.set(key, structuredClone(value))
    },
  }
}

const NOW = 1_800_000_000_000
const LEVER = 'https://jobs.lever.co/*'

const intent = (over: Partial<PermissionIntent> = {}): PermissionIntent => ({
  createdAt: NOW,
  frameId: 0,
  frameOrigin: 'https://jobs.lever.co',
  mode: 'application',
  pattern: LEVER,
  tabId: 7,
  ...over,
})

describe('matchIntentFrame', () => {
  const frames = [
    { frameId: 0, url: 'https://jobs.lever.co/spotify/65d6caca/apply' },
    { frameId: 3, url: 'https://careers-barrios.icims.com/jobs/2897/login?in_iframe=1' },
    { frameId: 4, url: 'about:blank' },
    { frameId: 5, url: 'chrome-extension://abc/picker.html' },
  ]

  it('accepts the top frame origin', () => {
    expect(matchIntentFrame(LEVER, frames)).toEqual({ frameId: 0, frameOrigin: 'https://jobs.lever.co' })
  })

  it('accepts an embedded frame origin and records which frame', () => {
    expect(matchIntentFrame('https://careers-barrios.icims.com/*', frames)).toEqual({
      frameId: 3,
      frameOrigin: 'https://careers-barrios.icims.com',
    })
  })

  it('rejects an origin that is not open in the tab', () => {
    expect(matchIntentFrame('https://jobs.ashbyhq.com/*', frames)).toBeNull()
  })

  it('rejects wildcard, scheme-only and malformed patterns', () => {
    expect(matchIntentFrame('*://*/*', frames)).toBeNull()
    expect(matchIntentFrame('https://*.lever.co/*', frames)).toBeNull()
    expect(matchIntentFrame('https://jobs.lever.co/spotify/*', frames)).toBeNull()
    expect(matchIntentFrame('chrome-extension://abc/*', frames)).toBeNull()
  })
})

describe('pending permission intent lifecycle', () => {
  it('a recorded intent is consumed exactly once', async () => {
    const area = makeArea()
    await recordPermissionIntent(area, intent(), NOW)
    expect(await takePermissionIntent(area, LEVER, NOW + 1_000)).toEqual(intent())
    expect(await takePermissionIntent(area, LEVER, NOW + 1_001)).toBeNull()
  })

  it('an intent for another origin is not consumed', async () => {
    const area = makeArea()
    await recordPermissionIntent(area, intent(), NOW)
    expect(await takePermissionIntent(area, 'https://jobs.ashbyhq.com/*', NOW)).toBeNull()
    expect(await takePermissionIntent(area, LEVER, NOW)).not.toBeNull()
  })

  it('an expired intent is never returned and is removed', async () => {
    const area = makeArea()
    await recordPermissionIntent(area, intent(), NOW)
    expect(await takePermissionIntent(area, LEVER, NOW + PERMISSION_INTENT_TTL_MS)).toBeNull()
    expect(area.raw.get(PERMISSION_INTENT_KEY)).toEqual({})
  })

  it('an intent from the future is not trusted', async () => {
    const area = makeArea()
    await recordPermissionIntent(area, intent({ createdAt: NOW + 60_000 }), NOW)
    expect(await takePermissionIntent(area, LEVER, NOW)).toBeNull()
  })

  it('recording prunes stale intents for other origins', async () => {
    const area = makeArea()
    await recordPermissionIntent(area, intent(), NOW)
    const ashby = intent({ frameOrigin: 'https://jobs.ashbyhq.com', pattern: 'https://jobs.ashbyhq.com/*' })
    await recordPermissionIntent(area, { ...ashby, createdAt: NOW + PERMISSION_INTENT_TTL_MS }, NOW + PERMISSION_INTENT_TTL_MS)
    expect(Object.keys(area.raw.get(PERMISSION_INTENT_KEY) as object)).toEqual(['https://jobs.ashbyhq.com/*'])
  })

  it('a newer choice for the same origin replaces the older one', async () => {
    const area = makeArea()
    await recordPermissionIntent(area, intent({ mode: 'notesOnly' }), NOW)
    await recordPermissionIntent(area, intent({ createdAt: NOW + 5, mode: 'application' }), NOW + 5)
    expect((await takePermissionIntent(area, LEVER, NOW + 10))?.mode).toBe('application')
  })

  it('cancel removes only the named origin', async () => {
    const area = makeArea()
    const ashby = intent({ frameOrigin: 'https://jobs.ashbyhq.com', pattern: 'https://jobs.ashbyhq.com/*' })
    await recordPermissionIntent(area, intent(), NOW)
    await recordPermissionIntent(area, ashby, NOW)
    await cancelPermissionIntent(area, LEVER, NOW)
    expect(await takePermissionIntent(area, LEVER, NOW)).toBeNull()
    expect(await takePermissionIntent(area, ashby.pattern, NOW)).toEqual(ashby)
  })

  it('malformed stored rows are ignored', async () => {
    const area = makeArea()
    area.raw.set(PERMISSION_INTENT_KEY, {
      [LEVER]: { ...intent(), mode: 'everything' },
      'https://jobs.ashbyhq.com/*': intent(),
    })
    expect(await takePermissionIntent(area, LEVER, NOW)).toBeNull()
    expect(await takePermissionIntent(area, 'https://jobs.ashbyhq.com/*', NOW)).toBeNull()
  })
})

describe('handleGrantedOrigins', () => {
  const setup = (enabled: string[], intents: Record<string, PermissionIntent>, enableOk = true) => {
    const calls: string[] = []
    const deps = {
      enable: async (pattern: string, mode: string) => {
        calls.push(`enable ${pattern} ${mode}`)
        return { ok: enableOk }
      },
      ensureRegistered: async (pattern: string) => {
        calls.push(`register ${pattern}`)
      },
      isEnabled: async (pattern: string) => enabled.includes(pattern),
      restoreIntent: async (intent: PermissionIntent) => {
        calls.push(`restore ${intent.pattern}`)
        intents[intent.pattern] = intent
      },
      takeIntent: async (pattern: string) => {
        const found = intents[pattern] ?? null
        delete intents[pattern]
        return found
      },
    }
    return { calls, deps }
  }

  it('a grant with a matching intent enables the origin in the chosen mode', async () => {
    const { calls, deps } = setup([], { [LEVER]: intent({ mode: 'notesOnly' }) })
    expect(await handleGrantedOrigins([LEVER], deps)).toEqual([{ action: 'enabled', pattern: LEVER }])
    expect(calls).toEqual([`enable ${LEVER} notesOnly`])
  })

  it('a grant without an intent enables nothing and guesses no mode', async () => {
    const { calls, deps } = setup([], {})
    expect(await handleGrantedOrigins([LEVER], deps)).toEqual([{ action: 'ignored', pattern: LEVER }])
    expect(calls).toEqual([])
  })

  it('a grant for an origin that is already enabled only re-registers its scripts', async () => {
    const { calls, deps } = setup([LEVER], { [LEVER]: intent() })
    expect(await handleGrantedOrigins([LEVER], deps)).toEqual([{ action: 'registered', pattern: LEVER }])
    expect(calls).toEqual([`register ${LEVER}`])
  })

  it('an intent is consumed once even when the same grant is reported twice', async () => {
    const { calls, deps } = setup([], { [LEVER]: intent() })
    await handleGrantedOrigins([LEVER], deps)
    await handleGrantedOrigins([LEVER], deps)
    expect(calls).toEqual([`enable ${LEVER} application`])
  })

  it('a failed enable keeps the intent so a retry can finish the grant', async () => {
    const intents = { [LEVER]: intent({ mode: 'notesOnly' }) }
    const failing = setup([], intents, false)
    expect(await handleGrantedOrigins([LEVER], failing.deps)).toEqual([{ action: 'failed', pattern: LEVER }])
    expect(failing.calls).toEqual([`enable ${LEVER} notesOnly`, `restore ${LEVER}`])
    const retry = setup([], intents)
    expect(await handleGrantedOrigins([LEVER], retry.deps)).toEqual([{ action: 'enabled', pattern: LEVER }])
    expect(retry.calls).toEqual([`enable ${LEVER} notesOnly`])
  })

  it('an enable that throws is treated as a failure, not a success', async () => {
    const intents = { [LEVER]: intent() }
    const { calls, deps } = setup([], intents)
    const throwing = { ...deps, enable: async () => Promise.reject(new Error('register failed')) }
    expect(await handleGrantedOrigins([LEVER], throwing)).toEqual([{ action: 'failed', pattern: LEVER }])
    expect(calls).toEqual([`restore ${LEVER}`])
  })

  it('each origin in one grant is decided on its own', async () => {
    const ashby = 'https://jobs.ashbyhq.com/*'
    const { calls, deps } = setup([], { [ashby]: intent({ pattern: ashby }) })
    expect(await handleGrantedOrigins([LEVER, ashby], deps)).toEqual([
      { action: 'ignored', pattern: LEVER },
      { action: 'enabled', pattern: ashby },
    ])
    expect(calls).toEqual([`enable ${ashby} application`])
  })
})

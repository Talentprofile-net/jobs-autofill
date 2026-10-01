import type { OriginMode } from '~/field/types'
import { normalizeOriginPattern, originFromPattern } from './originPattern'

export const PERMISSION_INTENT_KEY = 'tp.permissionIntents'
export const PERMISSION_INTENT_TTL_MS = 5 * 60 * 1000

export type PermissionIntent = {
  createdAt: number
  frameId: number
  frameOrigin: string
  mode: OriginMode
  pattern: string
  tabId: number
}

export type IntentStorageArea = {
  get: (key: string) => Promise<Record<string, unknown>>
  set: (items: Record<string, unknown>) => Promise<void>
}

export type TabFrame = { frameId: number; url?: string | null }

type IntentMap = Record<string, PermissionIntent>

const MODES = new Set<OriginMode>(['application', 'notesOnly', 'auto'])

const isIntent = (value: unknown): value is PermissionIntent => {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.pattern === 'string' &&
    typeof v.frameOrigin === 'string' &&
    typeof v.createdAt === 'number' &&
    typeof v.tabId === 'number' &&
    typeof v.frameId === 'number' &&
    MODES.has(v.mode as OriginMode)
  )
}

export const isLiveIntent = (intent: PermissionIntent, now: number): boolean => {
  const age = now - intent.createdAt
  return age >= 0 && age < PERMISSION_INTENT_TTL_MS
}

const readIntents = async (area: IntentStorageArea): Promise<IntentMap> => {
  const raw = (await area.get(PERMISSION_INTENT_KEY))[PERMISSION_INTENT_KEY]
  if (!raw || typeof raw !== 'object') return {}
  const out: IntentMap = {}
  for (const [pattern, intent] of Object.entries(raw as Record<string, unknown>)) {
    if (isIntent(intent) && intent.pattern === pattern) out[pattern] = intent
  }
  return out
}

const liveOnly = (intents: IntentMap, now: number): IntentMap =>
  Object.fromEntries(Object.entries(intents).filter(([, intent]) => isLiveIntent(intent, now)))

const writeIntents = (area: IntentStorageArea, intents: IntentMap): Promise<void> =>
  area.set({ [PERMISSION_INTENT_KEY]: intents })

export const matchIntentFrame = (
  pattern: string,
  frames: TabFrame[],
): { frameId: number; frameOrigin: string } | null => {
  const origin = originFromPattern(pattern)
  if (!origin) return null
  for (const frame of frames) {
    const url = frame.url ?? ''
    if (!/^https?:/i.test(url)) continue
    if (normalizeOriginPattern(url) !== pattern) continue
    return { frameId: frame.frameId, frameOrigin: origin }
  }
  return null
}

export const recordPermissionIntent = async (
  area: IntentStorageArea,
  intent: PermissionIntent,
  now: number,
): Promise<void> => {
  const intents = liveOnly(await readIntents(area), now)
  intents[intent.pattern] = intent
  await writeIntents(area, intents)
}

export const takePermissionIntent = async (
  area: IntentStorageArea,
  pattern: string,
  now: number,
): Promise<PermissionIntent | null> => {
  const intents = await readIntents(area)
  const found = intents[pattern] ?? null
  const remaining = liveOnly(intents, now)
  delete remaining[pattern]
  await writeIntents(area, remaining)
  return found && isLiveIntent(found, now) ? found : null
}

export const cancelPermissionIntent = async (
  area: IntentStorageArea,
  pattern: string,
  now: number,
): Promise<void> => {
  const intents = liveOnly(await readIntents(area), now)
  delete intents[pattern]
  await writeIntents(area, intents)
}

export type GrantedOriginDeps = {
  enable: (pattern: string, mode: OriginMode) => Promise<{ ok: boolean }>
  ensureRegistered: (pattern: string) => Promise<unknown>
  isEnabled: (pattern: string) => Promise<boolean>
  restoreIntent: (intent: PermissionIntent) => Promise<void>
  takeIntent: (pattern: string) => Promise<PermissionIntent | null>
}

export type GrantedOriginAction = 'enabled' | 'failed' | 'ignored' | 'registered'

export const handleGrantedOrigins = async (
  origins: string[],
  deps: GrantedOriginDeps,
): Promise<Array<{ action: GrantedOriginAction; pattern: string }>> => {
  const results: Array<{ action: GrantedOriginAction; pattern: string }> = []
  for (const pattern of origins) {
    if (await deps.isEnabled(pattern)) {
      await deps.ensureRegistered(pattern)
      results.push({ action: 'registered', pattern })
      continue
    }
    const intent = await deps.takeIntent(pattern)
    if (!intent) {
      results.push({ action: 'ignored', pattern })
      continue
    }
    const outcome = await deps.enable(pattern, intent.mode).catch(() => ({ ok: false }))
    if (outcome.ok) {
      results.push({ action: 'enabled', pattern })
      continue
    }
    await deps.restoreIntent(intent)
    results.push({ action: 'failed', pattern })
  }
  return results
}

import { browser } from 'wxt/browser'
import type { OriginMode } from '~/field/types'

const STORAGE_KEY = 'tp.enabledOrigins'

export type StoredEnabledOrigin = {
  pattern: string
  mode: OriginMode
}

type LegacyStorage = string[]
type CurrentStorage = StoredEnabledOrigin[]

const isCurrentEntry = (v: unknown): v is StoredEnabledOrigin => {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (typeof o.pattern !== 'string') return false
  if (o.mode !== 'application' && o.mode !== 'notesOnly' && o.mode !== 'auto') {
    return false
  }
  return true
}

const readRaw = async (): Promise<CurrentStorage> => {
  const res = await browser.storage.local.get(STORAGE_KEY)
  const raw = res[STORAGE_KEY] as CurrentStorage | LegacyStorage | undefined
  if (!Array.isArray(raw)) return []
  if (raw.length === 0) return []
  if (typeof raw[0] === 'string') {
    return (raw as LegacyStorage).map((pattern) => ({
      pattern,
      mode: 'application' as OriginMode,
    }))
  }
  return (raw as CurrentStorage).filter(isCurrentEntry)
}

export const getEnabledOrigins = async (): Promise<StoredEnabledOrigin[]> => {
  return readRaw()
}

export const getEnabledPatterns = async (): Promise<string[]> => {
  const entries = await readRaw()
  return entries.map((e) => e.pattern)
}

export const setEnabledOrigins = async (
  entries: StoredEnabledOrigin[],
): Promise<void> => {
  await browser.storage.local.set({ [STORAGE_KEY]: entries })
}

export const addEnabledOrigin = async (
  pattern: string,
  mode: OriginMode,
): Promise<void> => {
  const current = await readRaw()
  const existing = current.find((e) => e.pattern === pattern)
  if (existing) {
    if (existing.mode === mode) return
    existing.mode = mode
    await setEnabledOrigins(current)
    return
  }
  await setEnabledOrigins([...current, { pattern, mode }])
}

export const removeEnabledOrigin = async (pattern: string): Promise<void> => {
  const current = await readRaw()
  const next = current.filter((e) => e.pattern !== pattern)
  if (next.length === current.length) return
  await setEnabledOrigins(next)
}

export const updateEnabledOriginMode = async (
  pattern: string,
  mode: OriginMode,
): Promise<boolean> => {
  const current = await readRaw()
  const entry = current.find((e) => e.pattern === pattern)
  if (!entry) return false
  if (entry.mode === mode) return true
  entry.mode = mode
  await setEnabledOrigins(current)
  return true
}

export const isOriginEnabled = async (pattern: string): Promise<boolean> => {
  const current = await readRaw()
  return current.some((e) => e.pattern === pattern)
}

export const getOriginMode = async (
  pattern: string,
): Promise<OriginMode | null> => {
  const current = await readRaw()
  return current.find((e) => e.pattern === pattern)?.mode ?? null
}

export const normalizeOriginPattern = (input: string): string | null => {
  try {
    const url = new URL(input)
    return `${url.protocol}//${url.host}/*`
  } catch {
    return null
  }
}

export const originFromPattern = (pattern: string): string | null => {
  const match = /^(https?):\/\/([^/]+)\/\*$/.exec(pattern)
  if (!match) return null
  return `${match[1]}://${match[2]}`
}

const hashPattern = (pattern: string): string => {
  let h = 5381
  for (let i = 0; i < pattern.length; i++) {
    h = ((h << 5) + h + pattern.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}

export const dynamicScriptIds = (
  pattern: string,
): { content: string; main: string } => {
  const hash = hashPattern(pattern)
  return {
    content: `tp-dynamic-${hash}-c`,
    main: `tp-dynamic-${hash}-m`,
  }
}
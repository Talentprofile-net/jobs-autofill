import type { OriginMode } from '~/field/types'

export type OriginGrantDeps = {
  broadcast: (pattern: string, mode: OriginMode) => void
  hasPermission: (pattern: string) => Promise<boolean>
  inject: (pattern: string) => void
  readMode: (pattern: string) => Promise<OriginMode | null>
  register: (pattern: string) => Promise<void>
  save: (pattern: string, mode: OriginMode) => Promise<void>
  unregister: (pattern: string) => Promise<void>
}

export type OriginGrantResult = { ok: true } | { ok: false; error: string }

const failure = (e: unknown): OriginGrantResult => ({
  error: e instanceof Error ? e.message : String(e),
  ok: false,
})

export const enableGrantedOrigin = async (
  pattern: string,
  mode: OriginMode,
  deps: OriginGrantDeps,
): Promise<OriginGrantResult> => {
  let permitted = false
  try {
    permitted = await deps.hasPermission(pattern)
  } catch (e) {
    return failure(e)
  }
  if (!permitted) return { error: 'Permission not granted', ok: false }
  const previousMode = await deps.readMode(pattern)
  try {
    await deps.register(pattern)
  } catch (e) {
    return failure(e)
  }
  try {
    await deps.save(pattern, mode)
  } catch (e) {
    if (previousMode === null) await deps.unregister(pattern).catch(() => {})
    return failure(e)
  }
  if (previousMode === null) deps.inject(pattern)
  if (previousMode !== mode) deps.broadcast(pattern, mode)
  return { ok: true }
}

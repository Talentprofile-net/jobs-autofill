import { getOriginMode } from './enabledOrigins'
import { resolveAutoModeFromDom } from './autoModeHeuristic'
import type { ResolvedOriginMode } from '~/bridge/types'

export const resolveAutoMode = (): ResolvedOriginMode => resolveAutoModeFromDom()

export const resolveModeForPattern = async (
  pattern: string,
): Promise<ResolvedOriginMode> => {
  const stored = await getOriginMode(pattern)
  if (stored === 'application') return 'application'
  if (stored === 'notesOnly') return 'notesOnly'
  if (stored === 'auto') {
    return resolveAutoMode()
  }
  return 'application'
}
import { findOption } from './match'
import type { ProfileValue } from '~/field/types'

export const selectMatches = <T>(
  choices: T[],
  getText: (choice: T) => string,
  value: ProfileValue,
): T[] => {
  if (value.kind !== 'choice' && value.kind !== 'multiChoice') return []

  if (value.kind === 'multiChoice') {
    const matched: T[] = []
    for (const candidate of value.preferred) {
      const match = findOption(choices, getText, candidate)
      if (match && !matched.includes(match)) matched.push(match)
    }
    const unmatchedPreferred = value.preferred.length - matched.length
    if (unmatchedPreferred > 0 && value.fallbacks.length > 0) {
      for (const candidate of value.fallbacks) {
        const match = findOption(choices, getText, candidate)
        if (match && !matched.includes(match)) matched.push(match)
      }
    }
    return matched
  }

  const candidates = [value.preferred, ...value.fallbacks]
  for (const candidate of candidates) {
    const match = findOption(choices, getText, candidate)
    if (match) return [match]
  }
  return []
}
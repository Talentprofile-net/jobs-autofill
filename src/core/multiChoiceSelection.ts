import { findOption } from './match'
import type { ProfileValue } from '~/field/types'

export type SelectionPlan<T> = {
  toSelect: T[]
  toDeselect: T[]
}

const buildSet = <T>(items: T[]): Set<T> => {
  const out = new Set<T>()
  for (const item of items) out.add(item)
  return out
}

const planForMultiChoice = <T>(
  choices: T[],
  selected: Set<T>,
  getText: (c: T) => string,
  preferred: string[],
  fallbacks: string[],
): SelectionPlan<T> => {
  const matchedSet = new Set<T>()
  const matchedOrder: T[] = []

  const tryCandidates = (candidates: string[]): void => {
    for (const candidate of candidates) {
      const match = findOption(choices, getText, candidate)
      if (match && !matchedSet.has(match)) {
        matchedSet.add(match)
        matchedOrder.push(match)
      }
    }
  }

  tryCandidates(preferred)

  const desiredCount = preferred.length > 0 ? preferred.length : fallbacks.length
  if (matchedOrder.length < desiredCount && fallbacks.length > 0) {
    for (const candidate of fallbacks) {
      if (matchedOrder.length >= desiredCount) break
      const match = findOption(choices, getText, candidate)
      if (match && !matchedSet.has(match)) {
        matchedSet.add(match)
        matchedOrder.push(match)
      }
    }
  }

  const toSelect: T[] = []
  const toDeselect: T[] = []

  for (const choice of matchedOrder) {
    if (!selected.has(choice)) toSelect.push(choice)
  }
  for (const choice of selected) {
    if (!matchedSet.has(choice)) toDeselect.push(choice)
  }

  return { toSelect, toDeselect }
}

const planForChoice = <T>(
  choices: T[],
  selected: Set<T>,
  getText: (c: T) => string,
  preferred: string,
  fallbacks: string[],
): SelectionPlan<T> => {
  const candidates = [preferred, ...fallbacks]
  for (const candidate of candidates) {
    const match = findOption(choices, getText, candidate)
    if (!match) continue

    const toSelect = selected.has(match) ? [] : [match]
    const toDeselect: T[] = []
    for (const choice of selected) {
      if (choice !== match) toDeselect.push(choice)
    }
    return { toSelect, toDeselect }
  }
  return { toSelect: [], toDeselect: [] }
}

export const planSelection = <T>(
  choices: T[],
  selected: Iterable<T>,
  getText: (c: T) => string,
  value: ProfileValue,
): SelectionPlan<T> => {
  const selectedSet = buildSet(Array.from(selected))

  if (value.kind === 'multiChoice') {
    return planForMultiChoice(
      choices,
      selectedSet,
      getText,
      value.preferred,
      value.fallbacks,
    )
  }

  if (value.kind === 'choice') {
    return planForChoice(
      choices,
      selectedSet,
      getText,
      value.preferred,
      value.fallbacks,
    )
  }

  return { toSelect: [], toDeselect: [] }
}

export const desiredMatches = <T>(
  choices: T[],
  getText: (c: T) => string,
  value: ProfileValue,
): T[] => {
  const plan = planSelection(choices, [], getText, value)
  return plan.toSelect
}

export const verifySelectedSet = <T>(
  choices: T[],
  getText: (c: T) => string,
  isSelected: (c: T) => boolean,
  value: ProfileValue,
): boolean => {
  const matches = desiredMatches(choices, getText, value)
  if (matches.length === 0) return false
  const matchedSet = new Set(matches)
  for (const choice of choices) {
    const shouldBeSelected = matchedSet.has(choice)
    if (shouldBeSelected !== isSelected(choice)) return false
  }
  return true
}
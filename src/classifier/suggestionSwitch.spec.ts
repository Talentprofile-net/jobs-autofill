import { describe, expect, it } from 'bun:test'

import {
  CLASSIFIER_SUGGESTIONS_KEY,
  classifierSuggestionsEnabled,
  readClassifierSuggestions,
  writeClassifierSuggestions,
} from './suggestionSwitch'

const memory = (initial: Record<string, unknown> = {}) => {
  const values: Record<string, unknown> = { ...initial }
  return {
    get: async (key: string) => (key in values ? { [key]: values[key] } : {}),
    set: async (items: Record<string, unknown>) => {
      Object.assign(values, items)
    },
    values,
  }
}

describe('classifier suggestion switch', () => {
  it('is on for a fresh installation without writing a preference', async () => {
    const storage = memory()

    expect(await readClassifierSuggestions(storage)).toBe(true)
    expect(CLASSIFIER_SUGGESTIONS_KEY in storage.values).toBe(false)
  })

  it('turns on an existing installation that never stored a preference', async () => {
    expect(await readClassifierSuggestions(memory({ 'tp.profileCache': { data: null } }))).toBe(true)
  })

  it('keeps an explicit false off across a reload of the same storage', async () => {
    const storage = memory()
    await writeClassifierSuggestions(storage, false)
    const reloaded = memory(storage.values)

    expect(await readClassifierSuggestions(storage)).toBe(false)
    expect(await readClassifierSuggestions(reloaded)).toBe(false)
    expect(reloaded.values[CLASSIFIER_SUGGESTIONS_KEY]).toBe(false)
  })

  it('turns back on after an explicit false is replaced by true', async () => {
    const storage = memory({ [CLASSIFIER_SUGGESTIONS_KEY]: false })
    await writeClassifierSuggestions(storage, true)

    expect(await readClassifierSuggestions(storage)).toBe(true)
  })

  it.each<[string, unknown, boolean]>([
    ['no stored preference', undefined, true],
    ['an explicit true', true, true],
    ['an explicit false', false, false],
    ['null', null, false],
    ['the string "true"', 'true', false],
    ['the number 1', 1, false],
    ['an object', { enabled: true }, false],
  ])('reads %s', async (_, value, expected) => {
    const storage = memory(value === undefined ? {} : { [CLASSIFIER_SUGGESTIONS_KEY]: value })

    expect(classifierSuggestionsEnabled(value)).toBe(expected)
    expect(await readClassifierSuggestions(storage)).toBe(expected)
  })
})

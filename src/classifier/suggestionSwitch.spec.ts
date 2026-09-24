import { describe, expect, it } from 'bun:test'

import { readClassifierSuggestions, writeClassifierSuggestions } from './suggestionSwitch'

const memory = () => {
  const values: Record<string, unknown> = {}
  return {
    get: async (key: string) => ({ [key]: values[key] }),
    set: async (items: Record<string, unknown>) => {
      Object.assign(values, items)
    },
  }
}

describe('classifier suggestion switch', () => {
  it('is off until explicitly turned on', async () => {
    const storage = memory()
    expect(await readClassifierSuggestions(storage)).toBe(false)
    await writeClassifierSuggestions(storage, true)
    expect(await readClassifierSuggestions(storage)).toBe(true)
    await writeClassifierSuggestions(storage, false)
    expect(await readClassifierSuggestions(storage)).toBe(false)
  })
})

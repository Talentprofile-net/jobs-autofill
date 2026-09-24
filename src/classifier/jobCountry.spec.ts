import { describe, expect, it } from 'bun:test'

import { normalizeJobCountry } from './jobCountry'

describe('job country from the backend', () => {
  it('keeps an assigned ISO 3166-1 alpha-2 code', () => {
    expect(normalizeJobCountry('DE')).toBe('DE')
    expect(normalizeJobCountry('US')).toBe('US')
  })

  it('never guesses from anything else', () => {
    for (const value of ['de', 'Germany', 'DEU', 'XK', 'EU', 'ZZ', '', null, undefined, 49]) {
      expect(normalizeJobCountry(value)).toBe('_unknown')
    }
  })
})

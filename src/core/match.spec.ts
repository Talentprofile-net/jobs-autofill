import { describe, expect, it } from 'bun:test'

import { findUniqueOption, isPlaceholderText } from './match'

type Option = { text: string; value: string }
const options = (...pairs: [string, string][]): Option[] => pairs.map(([text, value]) => ({ text, value }))
const pick = (list: Option[], candidate: string) => findUniqueOption(list, (o) => o.text, candidate, (o) => o.value)?.text ?? null

describe('findUniqueOption', () => {
  it('picks a single exact match', () => {
    expect(pick(options(['Boston, MA', 'b'], ['New York, NY', 'n']), 'boston, ma')).toBe('Boston, MA')
  })

  it('refuses duplicate exact matches and ambiguous relaxed matches', () => {
    expect(pick(options(['Other', '1'], ['Other', '2']), 'Other')).toBeNull()
    expect(pick(options(['Portland, OR', 'o'], ['Portland, ME', 'm']), 'Portland')).toBeNull()
  })

  it('takes a unique relaxed match', () => {
    expect(pick(options(['Example City, Example Region', 'x'], ['Other Town', 'y']), 'Example City')).toBe('Example City, Example Region')
  })

  it('matches readable option values but never opaque ids', () => {
    expect(pick(options(['Germany', 'DE'], ['United States', 'US']), 'US')).toBe('United States')
    expect(pick(options(['Boston, MA', 'c6eff7ec-798d-4780-b3e4-bfa6c49b47e6']), 'c6eff7ec-798d-4780-b3e4-bfa6c49b47e6')).toBeNull()
  })

  it('does not match an empty candidate', () => {
    expect(pick(options(['', '']), '  ')).toBeNull()
  })
})

describe('isPlaceholderText', () => {
  it('treats ellipsis and colon placeholders as empty', () => {
    for (const text of ['Select...', 'Select…', 'Choose:', 'Please select...']) expect(isPlaceholderText(text)).toBe(true)
    expect(isPlaceholderText('Boston, MA')).toBe(false)
  })
})

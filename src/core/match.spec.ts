import { describe, expect, it } from 'bun:test'

import { findDialSelectorOption, findUniqueOption, isPlaceholderText } from './match'

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

  it('refuses a relaxed match whose qualifier contradicts the candidate', () => {
    expect(pick(options(['Example City, Other Region', 'a'], ['Second Town, Example Region', 'b']), 'Example City, Example Region')).toBeNull()
    expect(pick(options(['Yes', 'y'], ['No, but I will require sponsorship in the future', 'f']), 'No, I do not require sponsorship')).toBeNull()
  })

  it('matches readable option values but never opaque ids', () => {
    expect(pick(options(['Germany', 'DE'], ['United States', 'US']), 'US')).toBe('United States')
    expect(pick(options(['Boston, MA', 'c6eff7ec-798d-4780-b3e4-bfa6c49b47e6']), 'c6eff7ec-798d-4780-b3e4-bfa6c49b47e6')).toBeNull()
  })

  it('does not match an empty candidate', () => {
    expect(pick(options(['', '']), '  ')).toBeNull()
  })
})

describe('findDialSelectorOption', () => {
  const PHONE_COUNTRIES = ['United States +1', 'Canada +1', 'Thailand +66', 'Guernsey +44', 'Jersey +44', 'United Kingdom +44', 'Germany +49', 'Georgia +995']
  const pickDial = (candidates: string[], list = PHONE_COUNTRIES) => findDialSelectorOption(list, (text) => text, candidates)

  it('selects the profile country by name when the phone carries no dial code', () => {
    expect(pickDial(['Thailand', 'TH', 'THA'])).toBe('Thailand +66')
    expect(pickDial(['Thailand'], ['United States (+1)', 'Thailand (+66)', 'Germany (+49)'])).toBe('Thailand (+66)')
  })

  it('follows the phone dial code and uses the country only to choose among countries sharing it', () => {
    expect(pickDial(['Thailand', 'TH', '+66'])).toBe('Thailand +66')
    expect(pickDial(['United Kingdom', 'GB', '+44'])).toBe('United Kingdom +44')
    expect(pickDial(['United States', 'US', '+1'])).toBe('United States +1')
  })

  it('refuses a country that contradicts the phone dial code, an ambiguous code alone, and a full phone number', () => {
    expect(pickDial(['Thailand', 'TH', '+44'])).toBeNull()
    expect(pickDial(['+44'])).toBeNull()
    expect(pickDial(['+1'])).toBeNull()
    expect(pickDial(['+15555550123'])).toBeNull()
    expect(pickDial(['Atlantis'])).toBeNull()
  })
})

describe('isPlaceholderText', () => {
  it('treats ellipsis and colon placeholders as empty', () => {
    for (const text of ['Select...', 'Select…', 'Choose:', 'Please select...']) expect(isPlaceholderText(text)).toBe(true)
    expect(isPlaceholderText('Boston, MA')).toBe(false)
  })
})

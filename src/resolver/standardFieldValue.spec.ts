import { describe, expect, it } from 'bun:test'

import type { Profile } from '~/api/types'
import { STANDARD_FIELDS } from './standardField'
import { standardFieldValue } from './standardFieldValue'

const profile = (over: Partial<Profile> = {}): Profile => ({
  description: null,
  education: null,
  experience: null,
  hourlyRate: null,
  id: 'standard-profile',
  isAvailableForHire: null,
  isInterestedInRelocation: null,
  jobTitle: 'Staff Engineer',
  languages: null,
  links: [
    { id: 'l1', label: 'linkedin', url: 'https://www.linkedin.com/in/audit-tester' },
    { id: 'l2', label: 'github', url: 'https://github.com/audit-tester' },
  ],
  location: 'Berlin, Germany',
  monthlyRate: null,
  profileName: 'Audit Tester',
  rateCurrency: null,
  skills: null,
  talentAnswers: null,
  talentNotes: null,
  totalExperience: null,
  user: { email: 'audit.tester@example.invalid', phoneNumber: '+49 30 1234567' },
  ...over,
})

const text = (value: string) => ({ confidence: 'exact', kind: 'string', value })

describe('standard field values from the profile', () => {
  it.each([
    ['given-name', text('Audit')],
    ['family-name', text('Tester')],
    ['name', text('Audit Tester')],
    ['email', text('audit.tester@example.invalid')],
    ['tel', text('+49 30 1234567')],
    ['linkedin', text('https://www.linkedin.com/in/audit-tester')],
    ['github', text('https://github.com/audit-tester')],
    ['organization-title', text('Staff Engineer')],
    ['address-level2', text('Berlin')],
    ['country', text('Germany')],
  ] as const)('fills a text input for %p', (field, value) => {
    expect(standardFieldValue(field, 'TextInput', profile())).toEqual(value)
  })

  it('offers a country as a choice for a dropdown', () => {
    const value = standardFieldValue('country', 'SimpleDropdown', profile())
    expect(value?.kind).toBe('choice')
    if (value?.kind !== 'choice') return
    expect(value.preferred).toBe('Germany')
    expect(value.fallbacks).toContain('DE')
  })

  it('has a profile question for every standard field', () => {
    for (const field of STANDARD_FIELDS) expect(() => standardFieldValue(field, 'TextInput', profile())).not.toThrow()
  })

  it('refuses field types the standard field cannot fill', () => {
    expect(standardFieldValue('email', 'SimpleDropdown', profile())).toBeNull()
    expect(standardFieldValue('given-name', 'TextArea', profile())).toBeNull()
    expect(standardFieldValue('country', 'RadioGroup', profile())).toBeNull()
    expect(standardFieldValue('tel', 'SingleFileUpload', profile())).toBeNull()
  })

  it('refuses a missing or guessed profile value', () => {
    expect(standardFieldValue('given-name', 'TextInput', profile({ profileName: 'Audit' }))).toBeNull()
    expect(standardFieldValue('family-name', 'TextInput', profile({ profileName: null }))).toBeNull()
    expect(standardFieldValue('linkedin', 'TextInput', profile({ links: null }))).toBeNull()
    expect(standardFieldValue('address-level1', 'TextInput', profile({ location: 'Berlin, Germany' }))).toBeNull()
    expect(standardFieldValue('tel', 'TextInput', profile({ user: null }))).toBeNull()
  })
})

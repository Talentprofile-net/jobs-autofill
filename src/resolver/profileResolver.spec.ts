import { describe, expect, it } from 'bun:test'

import type { Profile } from '~/api/types'
import { resolveField } from './profileResolver'

const profile = (location: string | null): Profile => ({
  description: null,
  education: null,
  experience: null,
  hourlyRate: null,
  id: 'audit-profile',
  isAvailableForHire: null,
  isInterestedInRelocation: null,
  jobTitle: null,
  languages: null,
  links: null,
  location,
  monthlyRate: null,
  profileName: 'Audit Tester',
  rateCurrency: null,
  skills: null,
  talentAnswers: null,
  talentNotes: null,
  totalExperience: null,
  user: { email: 'audit.tester@example.invalid', phoneNumber: null },
})

describe('location for dropdown fields', () => {
  it('offers the raw location as a choice when it names no country', () => {
    expect(resolveField('What is your location?', 'SimpleDropdown', '', profile('Example City')).value).toEqual({ fallbacks: [], kind: 'choice', preferred: 'Example City' })
  })

  it('offers the raw location first and the parsed country after it', () => {
    const value = resolveField('What is your location?', 'SimpleDropdown', '', profile('Example City, Germany')).value
    expect(value.kind).toBe('choice')
    if (value.kind !== 'choice') return
    expect(value.preferred).toBe('Example City, Germany')
    expect(value.fallbacks[0]).toBe('Germany')
    expect(value.fallbacks).toContain('DE')
  })

  it('keeps a text location as plain text', () => {
    expect(resolveField('Current location', 'TextInput', '', profile('Example City')).value).toEqual({ confidence: 'exact', kind: 'string', value: 'Example City' })
  })
})

describe('preferred name versus preferred location', () => {
  it('keeps preferred name, nickname and alias on the name heuristic', () => {
    for (const label of ['Preferred name', 'Preferred first name', 'Nickname', 'Alias']) {
      expect(resolveField(label, 'TextInput', '', profile('Example City')).profileField).toBe('profileName')
    }
  })

  it('resolves preferred location and preferred office location from the profile location', () => {
    expect(resolveField('Preferred location', 'TextInput', '', profile('Example City'))).toEqual({
      profileField: 'location',
      value: { confidence: 'exact', kind: 'string', value: 'Example City' },
    })
    expect(resolveField('Preferred office location', 'SimpleDropdown', '', profile('Example City'))).toEqual({
      profileField: 'location',
      value: { fallbacks: [], kind: 'choice', preferred: 'Example City' },
    })
  })

  it('does not route other preferred questions to the location', () => {
    expect(resolveField('Preferred start date', 'TextInput', '', profile('Example City')).profileField).not.toBe('location')
  })
})

const withPhone = (phoneNumber: string): Profile => ({ ...profile('Example City'), user: { email: 'audit.tester@example.invalid', phoneNumber } })

describe('address questions', () => {
  it('leaves bare and street address questions unsupported instead of sending the city', () => {
    for (const label of ['Address', 'Address *', 'Street address', 'Address line 1', 'Home address']) {
      expect(resolveField(label, 'TextInput', '', profile('Example City')).value).toEqual({ kind: 'unsupported' })
    }
  })

  it('still sends the city to city and town questions', () => {
    for (const label of ['City', 'Town', 'Current city']) {
      expect(resolveField(label, 'TextInput', '', profile('Example City')).value).toEqual({ confidence: 'exact', kind: 'string', value: 'Example City' })
    }
  })

  it('keeps the email and website meaning of "address"', () => {
    expect(resolveField('Email address', 'TextInput', '', profile('Example City')).profileField).toBe('user.email')
  })
})

describe('behavioural prompts versus profile summary', () => {
  it('does not answer behavioural prompts with the profile summary', () => {
    for (const label of [
      'Tell us about a time when you had to communicate and coordinate with multiple teams',
      'Tell us about a situation where you missed a deadline',
      'Describe a time you handled conflict',
      'Tell us about your experience with Microsoft Office',
    ]) {
      expect(resolveField(label, 'TextInput', '', { ...profile('Example City'), description: 'Synthetic summary' }).profileField).not.toBe('description')
    }
  })

  it('keeps summary for explicit bio, summary and about-you questions', () => {
    for (const label of ['Professional summary', 'Short bio', 'Profile summary', 'Tell us about yourself', 'About you']) {
      expect(resolveField(label, 'TextInput', '', { ...profile('Example City'), description: 'Synthetic summary' }).profileField).toBe('description')
    }
  })

  it('never answers cover, motivation or interest letters with the profile summary', () => {
    const withSummary = { ...profile('Example City'), description: 'Synthetic summary' }
    for (const type of ['TextInput', 'ContentEditable']) {
      for (const label of ['Cover letter', 'Cover Letter*', 'Motivation letter', 'Motivational letter', 'Letter of interest', 'Letter of intent', 'Cover letter - tell us about yourself']) {
        expect(resolveField(label, type, '', withSummary)).toEqual({ profileField: null, value: { kind: 'unsupported' } })
      }
    }
  })
})

describe('phone fields rendered as dropdowns', () => {
  it('returns unsupported when the dial code cannot be derived unambiguously', () => {
    expect(resolveField('Phone', 'SimpleDropdown', '', withPhone('+15555550123')).value).toEqual({ kind: 'unsupported' })
  })

  it('offers the explicit dial code when the number separates it', () => {
    expect(resolveField('Phone', 'SimpleDropdown', '', withPhone('+44 20 7946 0000')).value).toEqual({ fallbacks: [], kind: 'choice', preferred: '+44' })
  })

  it('leaves ordinary phone text inputs unchanged and keeps country-code labels off the phone', () => {
    expect(resolveField('Phone', 'TextInput', '', withPhone('+15555550123')).value).toEqual({ confidence: 'exact', kind: 'string', value: '+15555550123' })
    expect(resolveField('Telephone country code', 'SimpleDropdown', '', withPhone('+15555550123')).profileField).not.toBe('user.phoneNumber')
  })
})

describe('file fields and self-assessment questions', () => {
  it('never resolves a profile text value for a file upload question', () => {
    for (const type of ['FileUpload', 'SingleFileUpload', 'MultiFileUpload']) {
      expect(resolveField('Cover Letter', type, '', { ...profile('Example City'), description: 'Synthetic summary' }).value).toEqual({ kind: 'unsupported' })
    }
  })

  it('does not answer skill or language self-ratings with the skills list', () => {
    const p: Profile = { ...profile('Example City'), languages: [{ id: 'l', language: 'English', rate: 5 }], skills: [{ id: 's', rate: 5, skill: 'Testing' }] }
    for (const label of ['How would you describe your presentation skills?', 'Rate your Python skills', 'Level of English proficiency']) {
      expect(resolveField(label, 'SimpleDropdown', '', p).value).toEqual({ kind: 'unsupported' })
    }
    expect(resolveField('Skills', 'TextInput', '', p).profileField).toBe('skills')
    expect(resolveField('Languages spoken', 'TextInput', '', p).profileField).toBe('languages')
  })
})

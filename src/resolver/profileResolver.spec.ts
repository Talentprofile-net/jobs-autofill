import { describe, expect, it } from 'bun:test'

import type { Profile } from '~/api/types'
import { talentAnswer } from '~/classifier/testAnswers'
import { resolveLearnedAnswersBatch } from './learnedAnswers'
import { normalizeQuestion } from './normalizeQuestion'
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

  it.each([
    'Are you legally authorized to work permanently in the country where you are applying?',
    "*Are you legally authorized to work permanently in the country where you're applying for this position?",
    'Will you now or in the future require employment visa sponsorship to work in the country in which the job you are applying for is located?*',
    'What is your current citizenship? + Do you require a work permit or visa to work at the mentioned office location?*Required',
    'Country of citizenship',
    'Passport Country',
    'Country of birth',
    'Work authorization country',
    'City of birth',
  ])('refuses the profile location for the authorization, citizenship or birthplace question %p', (label) => {
    for (const fieldType of ['TextInput', 'SimpleDropdown']) {
      expect(resolveField(label, fieldType, '', profile('Example City, Germany'))).toEqual({ profileField: null, value: { kind: 'unsupported' } })
    }
  })

  it('does not answer a place-specific relocation question from the relocation flag', () => {
    expect(resolveField('Are you currently based in or willing to relocate to the Bay Area for this position?', 'SimpleDropdown', '', { ...profile('Example City'), isInterestedInRelocation: true })).toEqual({ profileField: null, value: { kind: 'unsupported' } })
  })
})

describe('preferred name versus preferred location', () => {
  it.each([
    'Preferred First Name',
    'Preferred First & Last Name',
    'Preferred Name',
    'Nickname',
    'Alias',
    'Maiden Name',
    'Other names you have used',
    'Legal Name (if different than above)',
  ])('refuses the alternate identity field %p', (label) => {
    for (const fieldType of ['TextInput', 'SimpleDropdown']) {
      for (const section of ['', 'employment 1']) {
        expect(resolveField(label, fieldType, section, profile('Example City'))).toEqual({
          profileField: null,
          value: { kind: 'unsupported' },
        })
      }
    }
  })

  it('never fills an alternate identity field from a saved answer, even an exact one', () => {
    const questions = ['Preferred First Name', 'Preferred First & Last Name', 'Legal Name (if different than above)', 'Nickname']
    const saved = (questionText: string, i: number) =>
      talentAnswer({
        answerText: 'Saved Value',
        answerValue: { confidence: 'exact', kind: 'string', value: 'Saved Value' },
        id: `saved-${i}`,
        normalizedQuestion: normalizeQuestion(questionText),
        questionText,
      })
    const withAnswers = { ...profile('Example City'), talentAnswers: [...questions, 'Legal First Name'].map(saved) }
    const requests = [...questions, 'Legal First Name'].map((fieldName, i) => ({ fieldName, fieldType: 'TextInput', requestId: `r${i}`, section: '' }))
    expect(resolveLearnedAnswersBatch(requests, withAnswers, '_unknown').map((result) => [result.value.kind, result.matchedAnswerId])).toEqual([
      ['unsupported', null],
      ['unsupported', null],
      ['unsupported', null],
      ['unsupported', null],
      ['string', 'saved-4'],
    ])
  })

  it.each([
    ['Legal First Name', 'Audit'],
    ['Legal Last Name', 'Tester'],
    ['Legal Name', 'Audit Tester'],
    ['First Name', 'Audit'],
    ['Last Name', 'Tester'],
    ['Full Name', 'Audit Tester'],
  ])('keeps the legal name field %p', (label, value) => {
    expect(resolveField(label, 'TextInput', '', profile('Example City'))).toEqual({
      profileField: 'profileName',
      value: { confidence: 'exact', kind: 'string', value },
    })
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

  it.each(['Legal First and Last Name', 'First & Last Name', 'First/Last name'])('fills the combined first and last name field %p with the full name', (label) => {
    expect(resolveField(label, 'TextInput', '', profile('Example City'))).toEqual({
      profileField: 'profileName',
      value: { confidence: 'exact', kind: 'string', value: 'Audit Tester' },
    })
  })
})

describe('name pronunciation questions', () => {
  it.each([
    'How do you pronounce your name?',
    'Name pronunciation',
    'Phonetic spelling of your name',
    'How should we say your name?',
  ])('refuses the full name for %p', (label) => {
    for (const fieldType of ['TextInput', 'TextArea']) {
      expect(resolveField(label, fieldType, '', profile('Example City'))).toEqual({ profileField: null, value: { kind: 'unsupported' } })
    }
  })

  it.each([
    ['Full Name', 'Audit Tester'],
    ['Legal Name', 'Audit Tester'],
    ['Your name', 'Audit Tester'],
  ])('keeps the full name field %p', (label, value) => {
    expect(resolveField(label, 'TextInput', '', profile('Example City'))).toEqual({
      profileField: 'profileName',
      value: { confidence: 'exact', kind: 'string', value },
    })
  })

  it.each(['Thai Given Name', 'Thai Family Name', 'Full name (Katakana)', 'Your name in native script', 'How is your name spoken?'])('refuses the Latin profile name for the name representation field %p', (label) => {
    expect(resolveField(label, 'TextInput', '', profile('Example City'))).toEqual({ profileField: null, value: { kind: 'unsupported' } })
  })

  it('refuses the full name for a say-your-name question without "how"', () => {
    expect(resolveField("What's the correct way to say your name?", 'TextInput', '', profile('Example City'))).toEqual({ profileField: null, value: { kind: 'unsupported' } })
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

  it('does not send the applicant city to employer or school city questions outside a section', () => {
    for (const label of ['Company city', 'University city']) {
      expect(resolveField(label, 'TextInput', '', profile('Example City')).value).toEqual({ kind: 'unsupported' })
    }
  })

  it('leaves a compound street, city, postal code and country question unsupported', () => {
    expect(resolveField('Please provide your street address, city, postal/zip code and country?', 'TextInput', '', profile('Example City, Germany')).value).toEqual({ kind: 'unsupported' })
  })

  it('resolves the hyphenated and confirm wordings of the email address', () => {
    for (const label of ['E-mail address', 'Confirm email address']) {
      expect(resolveField(label, 'TextInput', '', profile('Example City'))).toEqual({
        profileField: 'user.email',
        value: { confidence: 'exact', kind: 'string', value: 'audit.tester@example.invalid' },
      })
    }
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

  it('keeps the phone number off device type and extension fields', () => {
    expect(resolveField('Phone Device Type', 'SimpleDropdown', '', withPhone('+44 20 7946 0000')).value).toEqual({ kind: 'unsupported' })
    expect(resolveField('Phone Extension', 'TextInput', '', withPhone('+44 20 7946 0000')).value).toEqual({ kind: 'unsupported' })
  })

  it('fills the full international number into a phone input that asks to include the country code but never into a country code field', () => {
    const p = withPhone('+44 20 7946 0000')
    expect(resolveField('Phone (include country code)', 'TextInput', '', p).value).toEqual({ confidence: 'exact', kind: 'string', value: '+44 20 7946 0000' })
    for (const fieldType of ['TextInput', 'SimpleDropdown']) {
      const value = resolveField('Telephone country code', fieldType, '', p).value
      const answered = value.kind === 'string' ? value.value : value.kind === 'choice' ? value.preferred : null
      expect(answered).not.toBe('+44 20 7946 0000')
    }
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

describe('contacts from the own-profile read', () => {
  const owned: Profile = {
    ...profile('Example City'),
    email: 'owner@example.invalid',
    links: [
      { id: 'a', label: 'other', url: 'https://github.com/audit-tester' },
      { id: 'b', label: 'other', url: 'https://www.linkedin.com/in/audit-tester' },
    ],
    phoneNumber: '+66 81 234 5678',
    user: null,
  }
  const text = (label: string) => resolveField(label, 'TextInput', '', owned).value

  it('fills email and phone from the profile when the account contacts are absent', () => {
    expect(text('Email')).toEqual({ confidence: 'exact', kind: 'string', value: 'owner@example.invalid' })
    expect(text('Phone')).toEqual({ confidence: 'exact', kind: 'string', value: '+66 81 234 5678' })
  })

  it('recognizes LinkedIn and GitHub links by host whatever their label', () => {
    expect(text('LinkedIn Profile')).toEqual({ confidence: 'exact', kind: 'string', value: 'https://www.linkedin.com/in/audit-tester' })
    expect(text('GitHub')).toEqual({ confidence: 'exact', kind: 'string', value: 'https://github.com/audit-tester' })
  })

  it('falls back to GitHub for a website when no other link exists', () => {
    expect(text('Website')).toEqual({ confidence: 'exact', kind: 'string', value: 'https://github.com/audit-tester' })
  })

  it.each(['Who referred you for this position?', 'Has someone at Example referred you for this role? If so, please include their name here'])('refuses the referral question %p', (label) => {
    expect(resolveField(label, 'TextInput', '', profile('Example City'))).toEqual({ profileField: null, value: { kind: 'unsupported' } })
  })

  it.each([
    'Referrer email',
    'Emergency contact phone',
    'Reference full name',
    "Your emergency contact's full name",
    "Manager's email",
    'Referrer LinkedIn profile',
    'Emergency contact city',
    "Your referrer's LinkedIn profile",
    'Reference phone number',
    'Emergency contact full name',
  ])('refuses the third-party contact field %p', (label) => {
    const p: Profile = { ...withPhone('+44 20 7946 0000'), links: [{ id: 'l', label: 'linkedin', url: 'https://www.linkedin.com/in/audit-tester' }] }
    expect(resolveField(label, 'TextInput', '', p)).toEqual({ profileField: null, value: { kind: 'unsupported' } })
  })

  it.each(['X', 'X / Twitter profile', 'Replit Profile URL', 'Other URL', 'Link to This Job'])('leaves the non-provider link field %p unsupported', (label) => {
    const p: Profile = {
      ...profile('Example City, Germany'),
      links: [
        { id: 'g', label: 'github', url: 'https://github.com/audit-tester' },
        { id: 'l', label: 'linkedin', url: 'https://www.linkedin.com/in/audit-tester' },
      ],
    }
    expect(resolveField(label, 'TextInput', '', p)).toEqual({ profileField: null, value: { kind: 'unsupported' } })
  })
})

describe('salary questions', () => {
  it('never answers a salary amount question with only the rate currency code', () => {
    const value = resolveField('Salary expectations (please include currency)', 'TextInput', '', { ...profile('Example City'), rateCurrency: 'EUR' }).value
    const answered = value.kind === 'string' ? value.value.trim() : value.kind === 'choice' ? value.preferred.trim() : null
    expect(answered).not.toBe('EUR')
  })
})

describe('demographic option labels', () => {
  it.each(['Asian', 'White', 'Man', 'Woman', 'Trans', 'Disabled Veteran', 'Prefer not to disclose', 'Hearing', 'Visual', 'Parent', 'I do not identify as a person with a disability'])('refuses the demographic option label %p', (label) => {
    for (const fieldType of ['SingleCheckbox', 'TextInput']) {
      expect(resolveField(label, fieldType, '', profile('Example City'))).toEqual({ profileField: null, value: { kind: 'unsupported' } })
    }
  })
})

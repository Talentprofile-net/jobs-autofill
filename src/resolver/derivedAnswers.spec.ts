import { describe, expect, it } from 'bun:test'

import type { Profile } from '~/api/types'
import { resolveField } from './profileResolver'

const NOW = new Date('2026-10-13T00:00:00Z')

const profile = (overrides: Partial<Profile> = {}): Profile => ({
  description: null,
  education: [{ degree: 'Bachelor of Computer Science', description: null, endDate: '2002-07-31', fieldOfStudy: null, gpa: null, id: 'ed', isCurrent: false, location: null, school: 'Example College', startDate: '1998-08-31' }],
  experience: null,
  hourlyRate: '100',
  id: 'audit-profile',
  isAvailableForHire: null,
  isInterestedInRelocation: null,
  jobTitle: null,
  languages: null,
  links: null,
  location: 'Thailand',
  monthlyRate: '9000',
  profileName: 'Audit Tester',
  rateCurrency: 'GBP',
  skills: null,
  talentAnswers: null,
  talentNotes: null,
  totalExperience: null,
  user: { email: 'audit.tester@example.invalid', phoneNumber: null },
  ...overrides,
})

const resolve = (question: string, fieldType: string, p: Profile = profile()) =>
  resolveField(question, fieldType, '', p, { now: NOW })

describe('how did you hear about this opportunity', () => {
  it('answers TalentProfile in a text field', () => {
    expect(resolve('How did you hear about this opportunity?', 'TextInput')).toEqual({
      profileField: 'applicationSource',
      value: { confidence: 'exact', kind: 'string', value: 'TalentProfile' },
    })
  })

  it('offers TalentProfile with job-board fallbacks for dropdowns and multi-select lists', () => {
    expect(resolve('How did you hear about us?', 'SimpleDropdown').value).toEqual({
      fallbacks: ['TalentProfile.net', 'Talent Profile', 'Job board', 'Job Board', 'Job boards', 'Online job board'],
      kind: 'choice',
      preferred: 'TalentProfile',
    })
    expect(resolve('How did you hear about this opportunity? (select all that apply)', 'MultiCheckbox').value.kind).toBe('multiChoice')
    expect(resolve('How did you hear about this opportunity?', 'MultiSearchableDropdown').value.kind).toBe('multiChoice')
  })

  it('answers even when the wording names the company or a referral', () => {
    expect(resolve('How did you hear about our company? (e.g. referral, LinkedIn)', 'TextInput').value).toEqual({ confidence: 'exact', kind: 'string', value: 'TalentProfile' })
  })

  it('does not treat a referrer name question as a source question', () => {
    expect(resolve('Who referred you?', 'TextInput').value).toEqual({ kind: 'unsupported' })
  })
})

describe('minimum age questions', () => {
  it('answers Yes when the earliest dated entry proves the age', () => {
    expect(resolve('Are you 25 years of age or older?', 'RadioGroup')).toEqual({
      profileField: 'experience.startDate',
      value: { fallbacks: ['True'], kind: 'choice', preferred: 'Yes' },
    })
    expect(resolve('Are you at least 18 years old?', 'SimpleDropdown').value).toEqual({ fallbacks: ['True'], kind: 'choice', preferred: 'Yes' })
    expect(resolve('Are you over the age of 21?', 'SingleCheckbox').value).toEqual({ kind: 'boolean', value: true })
  })

  it('never answers when the dates cannot prove the age', () => {
    const recent = profile({ education: null, experience: [{ company: 'Northwind', description: null, employmentType: null, endDate: null, id: 'e', isCurrent: true, location: null, startDate: '2020-01', title: 'Engineer' }] })
    expect(resolve('Are you 25 years of age or older?', 'RadioGroup', recent).value).toEqual({ kind: 'unsupported' })
    expect(resolve('Are you 25 years of age or older?', 'RadioGroup', profile({ education: null })).value).toEqual({ kind: 'unsupported' })
  })

  it('refuses negated, compound, hour and experience thresholds', () => {
    for (const question of [
      'Are you under 18 years of age?',
      'Are you at least 18 years of age and authorized to work in the US?',
      'Can you work 40+ hours per week?',
      'Do you have at least 10 years of experience?',
    ]) {
      expect([question, resolve(question, 'RadioGroup').value]).toEqual([question, { kind: 'unsupported' }])
    }
  })

  it('does not answer a free-text age field', () => {
    expect(resolve('Are you 25 years of age or older?', 'TextInput').value).toEqual({ kind: 'unsupported' })
  })
})

describe('desired compensation', () => {
  it('fills twelve months of the target monthly rate for total or annual compensation', () => {
    expect(resolve('What is your desired total compensation?', 'TextInput')).toEqual({
      profileField: 'monthlyRate',
      value: { confidence: 'exact', kind: 'string', value: '108000' },
    })
    expect(resolve('Expected annual salary (GBP)', 'TextInput').value).toEqual({ confidence: 'exact', kind: 'string', value: '108000' })
  })

  it('uses the matching rate for hourly and monthly wording', () => {
    expect(resolve('Desired hourly rate', 'TextInput').value).toEqual({ confidence: 'exact', kind: 'string', value: '100' })
    expect(resolve('What are your monthly salary expectations?', 'TextInput').value).toEqual({ confidence: 'exact', kind: 'string', value: '9000' })
  })

  it('refuses a question in another currency than the profile rates', () => {
    expect(resolve('Desired salary (USD)', 'TextInput').value).toEqual({ kind: 'unsupported' })
    expect(resolve('What is your expected salary in $?', 'TextInput').value).toEqual({ kind: 'unsupported' })
  })

  it('refuses current salary, missing rates, missing currency and non-text controls', () => {
    expect(resolve('What is your current salary?', 'TextInput').value).toEqual({ kind: 'unsupported' })
    expect(resolve('What is your desired total compensation?', 'TextInput', profile({ monthlyRate: null })).value).toEqual({ kind: 'unsupported' })
    expect(resolve('What is your desired total compensation?', 'TextInput', profile({ rateCurrency: null })).value).toEqual({ kind: 'unsupported' })
    expect(resolve('Desired salary range', 'SimpleDropdown').value).toEqual({ kind: 'unsupported' })
  })

  it('keeps refusing salary questions that do not ask for a desired amount', () => {
    expect(resolve('Salary history', 'TextInput').value).toEqual({ kind: 'unsupported' })
  })
})

describe('most recent employer', () => {
  const job = (company: string | null, startDate: string | null, isCurrent: boolean | null) => ({ company, description: null, employmentType: null, endDate: null, id: `${company}`, isCurrent, location: null, startDate, title: 'Engineer' })

  it('answers the latest experience entry by start date when none is marked current', () => {
    const p = profile({ experience: [job('Wunderman Thompson', '2022-04-30', false), job('Red Orange Co., Ltd', '2022-10-31', false), job('HERO Towers LTD', '2021-01-31', false)] })
    expect(resolve('Most Recent Employer', 'TextInput', p)).toEqual({ profileField: 'experience.company', value: { confidence: 'exact', kind: 'string', value: 'Red Orange Co., Ltd' } })
    expect(resolve('Current Company', 'TextInput', p).value).toEqual({ confidence: 'exact', kind: 'string', value: 'Red Orange Co., Ltd' })
  })

  it('prefers an entry marked current over a later-starting past one', () => {
    const p = profile({ experience: [job('Side Gig', '2024-01', false), job('Northwind', '2020-01', true)] })
    expect(resolve('Current employer', 'TextInput', p).value).toEqual({ confidence: 'exact', kind: 'string', value: 'Northwind' })
  })

  it('refuses employer details, dropdowns and an empty history', () => {
    const p = profile({ experience: [job('Northwind', '2020-01', true)] })
    for (const question of ['Current employer address', 'Most recent employer start date', 'Reason for leaving your last employer', "Most recent employer's phone"]) {
      expect([question, resolve(question, 'TextInput', p).value]).toEqual([question, { kind: 'unsupported' }])
    }
    expect(resolve('Most Recent Employer', 'SimpleDropdown', p).value).toEqual({ kind: 'unsupported' })
    expect(resolve('Most Recent Employer', 'TextInput', profile({ experience: null })).value).toEqual({ kind: 'unsupported' })
  })
})

describe('city inferred from the latest job', () => {
  const job = (location: string | null, startDate: string) => ({ company: 'Co', description: null, employmentType: null, endDate: null, id: startDate, isCurrent: false, location, startDate, title: 'Engineer' })

  it('uses the city of the latest job when its country matches the profile country', () => {
    const p = profile({ city: null, experience: [job('London, UK', '2021-01'), job('Bangkok, Thailand', '2022-10-31')] })
    expect(resolve('City', 'TextInput', p).value).toEqual({ confidence: 'exact', kind: 'string', value: 'Bangkok' })
    expect(resolve('Location (City)*', 'SimpleDropdown', p).value).toEqual({ fallbacks: [], kind: 'choice', preferred: 'Bangkok, Thailand' })
    const location = resolve('Location', 'SimpleDropdown', p).value
    expect(location.kind === 'choice' && location.preferred).toBe('Bangkok, Thailand')
  })

  it('keeps the profile city when it is set', () => {
    const p = profile({ city: 'Chiang Mai', experience: [job('Bangkok, Thailand', '2022-10-31')] })
    expect(resolve('City', 'TextInput', p).value).toEqual({ confidence: 'exact', kind: 'string', value: 'Chiang Mai' })
  })

  it('infers nothing when the latest job is in another country or has no city', () => {
    for (const location of ['London, UK', 'Thailand', null]) {
      const p = profile({ city: null, experience: [job(location, '2022-10-31')] })
      expect([location, resolve('City', 'TextInput', p).value]).toEqual([location, { kind: 'unsupported' }])
    }
  })
})

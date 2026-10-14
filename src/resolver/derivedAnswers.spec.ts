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

const referred = { now: NOW, referredByTalentProfile: true }
const direct = { now: NOW, referredByTalentProfile: false }
const resolve = (question: string, fieldType: string, p: Profile = profile(), context = direct) =>
  resolveField(question, fieldType, '', p, context)

describe('how did you hear about this opportunity', () => {
  it('answers TalentProfile in a text field when the tab came from a TalentProfile apply handoff', () => {
    expect(resolve('How did you hear about this opportunity?', 'TextInput', profile(), referred)).toEqual({
      profileField: 'applicationSource',
      value: { confidence: 'exact', kind: 'string', value: 'TalentProfile' },
    })
  })

  it('offers TalentProfile with job-board fallbacks for dropdowns and multi-select lists', () => {
    expect(resolve('How did you hear about us?', 'SimpleDropdown', profile(), referred).value).toEqual({
      fallbacks: ['TalentProfile.net', 'Talent Profile', 'Job board', 'Job Board', 'Job boards', 'Online job board'],
      kind: 'choice',
      preferred: 'TalentProfile',
    })
    expect(resolve('How did you hear about this opportunity? (select all that apply)', 'MultiCheckbox', profile(), referred).value.kind).toBe('multiChoice')
    expect(resolve('How did you hear about this opportunity?', 'MultiSearchableDropdown', profile(), referred).value.kind).toBe('multiChoice')
  })

  it('answers even when the wording names the company or a referral', () => {
    expect(resolve('How did you hear about our company? (e.g. referral, LinkedIn)', 'TextInput', profile(), referred).value).toEqual({ confidence: 'exact', kind: 'string', value: 'TalentProfile' })
  })

  it('leaves the question alone without a verified TalentProfile handoff', () => {
    expect(resolve('How did you hear about this opportunity?', 'TextInput').value).toEqual({ kind: 'unsupported' })
  })

  it('does not treat a referrer name question as a source question', () => {
    expect(resolve('Who referred you?', 'TextInput', profile(), referred).value).toEqual({ kind: 'unsupported' })
  })
})

describe('age questions', () => {
  it('abstains without an explicit birth date, whatever the education and job dates say', () => {
    for (const question of ['Are you 25 years of age or older?', 'Are you at least 18 years old?']) {
      for (const fieldType of ['RadioGroup', 'SimpleDropdown', 'SingleCheckbox']) {
        expect([question, fieldType, resolve(question, fieldType).value]).toEqual([question, fieldType, { kind: 'unsupported' }])
      }
    }
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

describe('start date and notice period', () => {
  const asked = 'When is the soonest you could start?'

  it('answers the available-from date when it is in the future', () => {
    expect(resolve(asked, 'TextInput', profile({ availableFrom: '2026-11-01' }))).toEqual({ profileField: 'availableFrom', value: { day: '01', kind: 'date', month: '11', year: '2026' } })
  })

  it('answers today when the available-from date has passed', () => {
    expect(resolve('Earliest start date', 'MonthDayYear', profile({ availableFrom: '2026-01-15' })).value).toEqual({ day: '13', kind: 'date', month: '10', year: '2026' })
  })

  it('adds the notice period to today when no available-from date is set', () => {
    expect(resolve(asked, 'TextInput', profile({ noticePeriodDays: 30 }))).toEqual({ profileField: 'noticePeriodDays', value: { day: '12', kind: 'date', month: '11', year: '2026' } })
  })

  it('abstains without either fact', () => {
    expect(resolve(asked, 'TextInput').value).toEqual({ kind: 'unsupported' })
  })

  it('words the notice period for text and choice fields', () => {
    expect(resolve('What is your notice period?', 'TextInput', profile({ noticePeriodDays: 14 })).value).toEqual({ confidence: 'exact', kind: 'string', value: '2 weeks' })
    expect(resolve('Notice period', 'SimpleDropdown', profile({ noticePeriodDays: 30 })).value).toEqual({ fallbacks: ['30 days'], kind: 'choice', preferred: '1 month' })
    expect(resolve('Notice period', 'SimpleDropdown', profile({ noticePeriodDays: 0 })).value).toEqual({ fallbacks: ['Immediate', 'Immediately available', 'None', '0 days'], kind: 'choice', preferred: 'Immediately' })
    expect(resolve('Notice period', 'TextInput').value).toEqual({ kind: 'unsupported' })
  })

  it('answers a start-date dropdown with the notice period wording', () => {
    expect(resolve('When can you start?', 'SimpleDropdown', profile({ noticePeriodDays: 14 })).value).toEqual({ fallbacks: ['14 days'], kind: 'choice', preferred: '2 weeks' })
  })

  it('leaves employment-section start dates to the experience entries', () => {
    const p = profile({ availableFrom: '2026-11-01', experience: [{ company: 'Northwind', description: null, employmentType: null, endDate: null, id: 'e', isCurrent: true, location: null, startDate: '2020-01-15', title: 'Engineer' }] })
    expect(resolveField('Start date', 'MonthDayYear', 'Employment 1', p, direct).value).toEqual({ day: '15', kind: 'date', month: '01', year: '2020' })
  })
})

describe('address, region and postal code', () => {
  const home = profile({ addressLine1: '99 Sukhumvit Road', addressLine2: 'Unit 12', city: 'Bangkok', postalCode: '10110', region: 'Bangkok' })

  it('fills explicit address parts, region and postal code', () => {
    expect(resolve('Address line 1', 'TextInput', home).value).toEqual({ confidence: 'exact', kind: 'string', value: '99 Sukhumvit Road' })
    expect(resolve('Street address', 'TextInput', home).value).toEqual({ confidence: 'exact', kind: 'string', value: '99 Sukhumvit Road' })
    expect(resolve('Address line 2 (apartment, suite, unit)', 'TextInput', home).value).toEqual({ confidence: 'exact', kind: 'string', value: 'Unit 12' })
    expect(resolve("What's your postal code?", 'TextInput', home)).toEqual({ profileField: 'postalCode', value: { confidence: 'exact', kind: 'string', value: '10110' } })
    expect(resolve('What is the zip code of your primary residence?', 'TextInput', home).value).toEqual({ confidence: 'exact', kind: 'string', value: '10110' })
    expect(resolve('State / Province', 'TextInput', home).value).toEqual({ confidence: 'exact', kind: 'string', value: 'Bangkok' })
  })

  it('composes a single address field from the explicit parts', () => {
    expect(resolve('Address', 'TextInput', home).value).toEqual({ confidence: 'exact', kind: 'string', value: '99 Sukhumvit Road, Unit 12, Bangkok, Bangkok 10110, Thailand' })
  })

  it('abstains on address and postal code without explicit values', () => {
    expect(resolve('Address', 'TextInput').value).toEqual({ kind: 'unsupported' })
    expect(resolve('Zip code', 'TextInput', profile({ city: 'Bangkok' })).value).toEqual({ kind: 'unsupported' })
  })

  it('never infers the city from the latest job', () => {
    const p = profile({ city: null, experience: [{ company: 'Co', description: null, employmentType: null, endDate: null, id: 'e', isCurrent: false, location: 'Bangkok, Thailand', startDate: '2022-10-31', title: 'Engineer' }] })
    expect(resolve('City', 'TextInput', p).value).toEqual({ kind: 'unsupported' })
  })

  it('still reads the city from a legacy combined location', () => {
    const legacy = profile({ city: null, location: 'Bangkok, Thailand' })
    expect(resolve('City', 'TextInput', legacy).value).toEqual({ confidence: 'exact', kind: 'string', value: 'Bangkok' })
    expect(resolve('Location (City)*', 'SimpleDropdown', legacy).value).toEqual({ fallbacks: [], kind: 'choice', preferred: 'Bangkok, Thailand' })
    expect(resolve('Address', 'TextInput', profile({ addressLine1: '99 Sukhumvit Road', city: null, location: 'Bangkok, Thailand' })).value).toEqual({ confidence: 'exact', kind: 'string', value: '99 Sukhumvit Road, Bangkok, Thailand' })
  })
})

describe('postal code from an explicit address', () => {
  const postal = (overrides: Partial<Profile>) => resolve('Postal code', 'TextInput', profile(overrides)).value

  it('takes the one postal code written in the address lines for the profile country', () => {
    expect(postal({ addressLine1: '99 Sukhumvit Road', addressLine2: 'Khlong Toei 10110' })).toEqual({ confidence: 'exact', kind: 'string', value: '10110' })
  })

  it('prefers the explicit postal code', () => {
    expect(postal({ addressLine2: 'Khlong Toei 10110', postalCode: '10120' })).toEqual({ confidence: 'exact', kind: 'string', value: '10120' })
  })

  it('ignores a leading house number and refuses two different candidates', () => {
    expect(postal({ addressLine1: '10110 Sukhumvit Road' })).toEqual({ kind: 'unsupported' })
    expect(postal({ addressLine1: '1 Road', addressLine2: '10110 or 10120' })).toEqual({ kind: 'unsupported' })
  })

  it('never derives a postal code from the country or city alone', () => {
    expect(postal({ city: 'Bangkok' })).toEqual({ kind: 'unsupported' })
    expect(postal({ addressLine2: 'Khlong Toei 10110', location: null })).toEqual({ kind: 'unsupported' })
  })
})

describe('phone number stored in E.164 form', () => {
  const thai = profile({ phoneNumber: '+66995503642' })

  it('writes the international format into a text field', () => {
    expect(resolve('Phone', 'TextInput', thai).value).toEqual({ confidence: 'exact', kind: 'string', value: '+66 99 550 3642' })
  })

  it('offers the stored dial code to a country selector', () => {
    const country = resolve('Country', 'SimpleDropdown', thai).value
    expect(country.kind === 'choice' && country.fallbacks.at(-1)).toBe('+66')
  })

  it('combines a legacy national number with the explicit profile country', () => {
    expect(resolve('Phone', 'TextInput', profile({ phoneNumber: '0995554433' })).value).toEqual({ confidence: 'exact', kind: 'string', value: '+66 99 555 4433' })
  })

  it('keeps a legacy national number unchanged without a profile country', () => {
    expect(resolve('Phone', 'TextInput', profile({ location: null, phoneNumber: '0995554433' })).value).toEqual({ confidence: 'exact', kind: 'string', value: '0995554433' })
  })

  it('never takes the phone country from a job location', () => {
    const p = profile({ experience: [{ company: 'Co', description: null, employmentType: null, endDate: null, id: 'e', isCurrent: true, location: 'Bangkok, Thailand', startDate: '2022-01', title: 'Engineer' }], location: null, phoneNumber: '0995554433' })
    expect(resolve('Phone', 'TextInput', p).value).toEqual({ confidence: 'exact', kind: 'string', value: '0995554433' })
  })
})

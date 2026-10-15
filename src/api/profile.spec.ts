import { describe, expect, it } from 'bun:test'

import { resolveField } from '~/resolver/profileResolver'
import { normalizeProfile } from './profile'

const stored = {
  description: null,
  education: [{ degree: 'Bachelor of Computer Science', description: 'IT engineer', end: '2002-07-31', id: 'ed', location: 'Budapest, Hungary', ongoing: false, program: 'N/A', school: 'DENNIS GABOR COLLEGE', start: '1998-08-31' }],
  experience: [
    { company: 'Red Orange Co., Ltd', description: null, end: null, id: 'e1', location: 'Bangkok, Thailand', ongoing: false, start: '2022-10-31', title: 'Front - end developer (web & desktop)' },
    { company: 'Wunderman Thompson', description: null, end: '2022-10-30', id: 'e2', location: 'London, UK', ongoing: false, start: '2022-04-30', title: 'Senior Front-end Developer' },
  ],
  hourlyRate: '100000',
  id: 'p',
  isAvailableForHire: null,
  isInterestedInRelocation: true,
  jobTitle: 'Full-Stack Engineer',
  languages: null,
  links: null,
  location: 'Thailand',
  monthlyRate: '10000000',
  profileName: 'Audit Tester',
  rateCurrency: 'GBP',
  skills: null,
  talentAnswers: null,
  talentNotes: null,
  totalExperience: '10',
  user: { email: 'audit@example.invalid', phoneNumber: '0995503642' },
}

describe('stored profile entries', () => {
  it('maps the stored start, end and ongoing keys onto the entry dates the resolver reads', () => {
    const profile = normalizeProfile(stored)
    expect(profile.education?.[0]).toEqual({ degree: 'Bachelor of Computer Science', description: 'IT engineer', endDate: '2002-07-31', fieldOfStudy: null, gpa: null, id: 'ed', isCurrent: false, location: 'Budapest, Hungary', school: 'DENNIS GABOR COLLEGE', startDate: '1998-08-31' })
    expect(profile.experience?.map((entry) => [entry.company, entry.startDate, entry.endDate, entry.isCurrent])).toEqual([
      ['Red Orange Co., Ltd', '2022-10-31', null, false],
      ['Wunderman Thompson', '2022-04-30', '2022-10-30', false],
    ])
  })

  it('keeps entries that already use the resolver keys', () => {
    const profile = normalizeProfile({ ...stored, experience: [{ company: 'Northwind', id: 'n', isCurrent: true, startDate: '2020-01' }] })
    const entry = profile.experience?.[0]
    expect([entry?.company, entry?.startDate, entry?.endDate, entry?.isCurrent]).toEqual(['Northwind', '2020-01', null, true])
  })

  it('passes the application-detail fields through unchanged', () => {
    const profile = normalizeProfile({ ...stored, noticePeriodDays: 30, postalCode: '10110' })
    expect([profile.noticePeriodDays, profile.postalCode]).toEqual([30, '10110'])
  })

  it('ignores a stale available-from date from an older profile payload', () => {
    const legacy = { ...stored, availableFrom: '2026-01-15', noticePeriodDays: 30 }
    const value = resolveField('When is the soonest you could start?', 'TextInput', '', normalizeProfile(legacy), { now: new Date('2026-10-14T00:00:00Z'), referredByTalentProfile: false }).value
    expect(value).toEqual({ day: '13', kind: 'date', month: '11', year: '2026' })
  })

  it('leaves age questions unanswered even with stored education dates', () => {
    const value = resolveField('Are you 25 years of age or older?', 'RadioGroup', '', normalizeProfile(stored), { now: new Date('2026-10-14T00:00:00Z'), referredByTalentProfile: false }).value
    expect(value).toEqual({ kind: 'unsupported' })
  })
})

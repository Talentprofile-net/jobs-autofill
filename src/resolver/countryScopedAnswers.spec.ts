import { describe, expect, it } from 'bun:test'

import type { Profile, TalentAnswer } from '~/api/types'
import { answersForJob, isCountryScopedQuestion } from './countryScopedAnswers'
import { learnedAnswerToProfileValue } from './learnedAnswerMatcher'
import { resolveLearnedAnswersBatch } from './learnedAnswers'

const answer = (id: string, questionText: string, jobCountry: string | null, value: boolean): TalentAnswer => ({
  answerKind: 'boolean',
  answerText: value ? 'Yes' : 'No',
  answerValue: { kind: 'boolean', value },
  ats: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  fieldType: 'SimpleDropdown',
  id,
  jobCountry,
  labelEnumId: null,
  lastUsedAt: null,
  normalizedQuestion: questionText.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
  pageUrl: null,
  profileField: null,
  questionText,
  resolverOutcome: null,
  section: null,
  source: 'manual',
  sourceAnswerId: null,
  talentJobApplicationId: null,
  talentProfileId: 'p',
  updatedAt: '2026-10-01T00:00:00.000Z',
})

const SPONSOR = 'Will you now or in the future require visa sponsorship?'
const canada = answer('ca', SPONSOR, 'CA', false)
const unitedStates = answer('us', SPONSOR, 'US', true)
const legacy = answer('legacy', SPONSOR, null, false)
const okta = answer('okta', 'Have you been employed by Okta in the past?', 'CA', false)

describe('country-scoped answer reuse', () => {
  it('treats authorization, sponsorship and visa questions as country-scoped', () => {
    expect(isCountryScopedQuestion(SPONSOR)).toBe(true)
    expect(isCountryScopedQuestion('Are you legally authorized to work in the country you reside?')).toBe(true)
    expect(isCountryScopedQuestion('Do you have the right to work in the UK?')).toBe(true)
    expect(isCountryScopedQuestion('Have you been employed by Okta in the past?')).toBe(false)
  })

  it('reuses a country-scoped answer only for the same job country', () => {
    const all = [canada, unitedStates, legacy]
    expect(answersForJob(all, SPONSOR, 'CA')).toEqual([canada])
    expect(answersForJob(all, SPONSOR, 'US')).toEqual([unitedStates])
    expect(answersForJob(all, SPONSOR, 'DE')).toEqual([])
    expect(answersForJob(all, SPONSOR, '_unknown')).toEqual([])
  })

  it('keeps every answer for a question that does not depend on the country', () => {
    expect(answersForJob([okta], okta.questionText, '_unknown')).toEqual([okta])
  })

  it('fills a sponsorship question from the matching country only', () => {
    const profile: Profile = {
      description: null,
      education: null,
      experience: null,
      hourlyRate: null,
      id: 'p',
      isAvailableForHire: null,
      isInterestedInRelocation: null,
      jobTitle: null,
      languages: null,
      links: null,
      location: null,
      monthlyRate: null,
      profileName: null,
      rateCurrency: null,
      skills: null,
      talentAnswers: [unitedStates, canada],
      talentNotes: null,
      totalExperience: null,
      user: null,
    }
    const request = [{ fieldName: SPONSOR, fieldType: 'SimpleDropdown', requestId: 'r', section: '' }]
    const fill = (jobCountry: string) => resolveLearnedAnswersBatch(request, profile, jobCountry)[0]
    expect(fill('CA').matchedAnswerId).toBe('ca')
    expect(fill('US').matchedAnswerId).toBe('us')
    expect(fill('GB').value).toEqual({ kind: 'unsupported' })
  })
})

describe('a saved yes/no answer on a dropdown', () => {
  it('fills the dropdown with the matching Yes or No option', () => {
    expect(learnedAnswerToProfileValue({ answer: canada, method: 'normalized_text', score: 1 }, 'SimpleDropdown')).toEqual({ fallbacks: ['False'], kind: 'choice', preferred: 'No' })
    expect(learnedAnswerToProfileValue({ answer: unitedStates, method: 'normalized_text', score: 1 }, 'RadioGroup')).toEqual({ fallbacks: ['True'], kind: 'choice', preferred: 'Yes' })
    expect(learnedAnswerToProfileValue({ answer: canada, method: 'normalized_text', score: 1 }, 'SingleCheckbox')).toEqual({ kind: 'boolean', value: false })
  })
})

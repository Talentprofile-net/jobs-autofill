import { describe, expect, it } from 'bun:test'

import type { Profile, TalentAnswer } from '~/api/types'
import { talentAnswer } from '~/classifier/testAnswers'
import { resolveLearnedAnswersBatch } from './learnedAnswers'
import { normalizeQuestion } from './normalizeQuestion'

const saved = (id: string, questionText: string, value: string, over: Partial<TalentAnswer> = {}) =>
  talentAnswer({
    answerText: value,
    answerValue: { confidence: 'exact', kind: 'string', value },
    id,
    normalizedQuestion: normalizeQuestion(questionText),
    questionText,
    ...over,
  })

const profile = (talentAnswers: TalentAnswer[]): Profile => ({
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
  location: null,
  monthlyRate: null,
  profileName: 'Audit Tester',
  rateCurrency: null,
  skills: null,
  talentAnswers,
  talentNotes: null,
  totalExperience: null,
  user: { email: 'audit.tester@example.invalid', phoneNumber: null },
})

const resolve = (fieldName: string, answers: TalentAnswer[], fieldType = 'TextInput') => {
  const [result] = resolveLearnedAnswersBatch([{ fieldName, fieldType, requestId: 'r', section: '' }], profile(answers), '_unknown')
  return { matchedAnswerId: result.matchedAnswerId, value: result.value }
}

const unsupported = { matchedAnswerId: null, value: { kind: 'unsupported' } }

describe('learned answers for name pronunciation', () => {
  it.each(['How do you pronounce your name?', 'Name pronunciation', 'Phonetic spelling of your name', 'How should we say your name?'])(
    'fills %p from an exact normalized saved answer',
    (question) => {
      expect(resolve(question, [saved('exact', question.toUpperCase(), 'AW-dit TES-ter')])).toEqual({
        matchedAnswerId: 'exact',
        value: { confidence: 'exact', kind: 'string', value: 'AW-dit TES-ter' },
      })
    },
  )

  it('refuses a word-overlap match', () => {
    const answers = [saved('overlap', 'Phonetic spelling of your full name', 'AW-dit TES-ter')]
    expect(resolve('Phonetic spelling of your name', answers)).toEqual(unsupported)
  })

  it('keeps the word-overlap match for an ordinary question', () => {
    const answers = [saved('overlap', 'Expected annual salary in euros', '90000')]
    expect(resolve('Expected annual salary (euros)', answers).matchedAnswerId).toBe('overlap')
  })

  it('keeps the field type check on the exact answer', () => {
    const answers = [saved('select', 'Name pronunciation', 'AW-dit TES-ter', { fieldType: 'SimpleDropdown' })]
    expect(resolve('Name pronunciation', answers)).toEqual(unsupported)
  })

  it('never links a full name answer to a pronunciation question', () => {
    expect(resolve('How do you pronounce your name?', [saved('full', 'Full name', 'Audit Tester'), saved('your', 'Your name', 'Audit Tester')])).toEqual(unsupported)
  })

  it('fills preferred pronouns from the exact saved answer', () => {
    expect(resolve('Preferred pronouns', [saved('pronouns', 'Preferred pronouns', 'they/them')])).toEqual({
      matchedAnswerId: 'pronouns',
      value: { confidence: 'exact', kind: 'string', value: 'they/them' },
    })
  })
})

describe('learned answers for negated questions', () => {
  it('does not fill a negated question from the saved answer to its positive form', () => {
    expect(resolve('Are you not willing to work weekends?', [saved('weekends', 'Are you willing to work weekends?', 'Yes')])).toEqual(unsupported)
  })
})

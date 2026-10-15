import { describe, expect, it } from 'bun:test'

import type { Profile, TalentAnswer } from '~/api/types'
import { fieldsWithoutProfileValue, mergeFillValues } from '~/bridge/fillValues'
import { answersForApplication, isCoverLetterQuestion } from './coverLetter'
import { isCvFileRequest } from './cvFile'
import { resolveLearnedAnswersBatch } from './learnedAnswers'
import { normalizeQuestion } from './normalizeQuestion'
import { resolveField } from './profileResolver'

const storedAnswer = (questionText: string, value: string, talentJobApplicationId: string | null = 'app-1'): TalentAnswer =>
  ({
    answerKind: 'text',
    answerText: value,
    answerValue: { confidence: 'exact', kind: 'string', value },
    ats: 'generic',
    createdAt: '2026-09-01T00:00:00.000Z',
    fieldType: 'TextArea',
    id: questionText === 'Cover letter' ? 'cover-answer' : 'other-answer',
    labelEnumId: null,
    lastUsedAt: null,
    normalizedQuestion: normalizeQuestion(questionText),
    pageUrl: null,
    profileField: null,
    questionText,
    resolverOutcome: 'filled',
    section: null,
    source: 'manual',
    sourceAnswerId: null,
    talentJobApplicationId,
    talentProfileId: 'audit-profile',
    updatedAt: '2026-09-01T00:00:00.000Z',
  }) as TalentAnswer

const profile = (talentAnswers: TalentAnswer[]): Profile => ({
  description: 'Synthetic profile summary',
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

const fill = (fieldName: string, fieldType: string, p: Profile, applicationId: string | null = null) => {
  const fields = [{ fieldName, fieldType, requestId: 'r1', section: '' }]
  const fromProfile = fields.map((f) => ({ requestId: f.requestId, ...resolveField(f.fieldName, f.fieldType, f.section, p) }))
  const learned = resolveLearnedAnswersBatch(fieldsWithoutProfileValue(fields, fromProfile), p, '_unknown', applicationId)
  return mergeFillValues(fields, fromProfile, learned)[0]
}

describe('cover-letter questions through the fill-value pipeline', () => {
  it('reuses a stored cover letter on the same application', () => {
    const result = fill('Cover letter', 'TextInput', profile([storedAnswer('Cover letter', 'Saved cover letter text')]), 'app-1')
    expect(result).toEqual({ matchedAnswerId: 'cover-answer', profileField: null, requestId: 'r1', value: { confidence: 'exact', kind: 'string', value: 'Saved cover letter text' } })
  })

  it('never reuses a cover letter written for another application', () => {
    const result = fill('Cover letter', 'TextInput', profile([storedAnswer('Cover letter', 'Letter for company A')]), 'app-2')
    expect(result).toEqual({ matchedAnswerId: null, profileField: null, requestId: 'r1', value: { kind: 'unsupported' } })
  })

  it('never reuses a cover letter when either application id is missing', () => {
    expect(fill('Cover letter', 'TextInput', profile([storedAnswer('Cover letter', 'Letter', 'app-1')]), null).value).toEqual({ kind: 'unsupported' })
    expect(fill('Cover letter', 'TextInput', profile([storedAnswer('Cover letter', 'Letter', null)]), 'app-1').value).toEqual({ kind: 'unsupported' })
    expect(fill('Cover letter', 'TextInput', profile([storedAnswer('Cover letter', 'Letter', null)]), null).value).toEqual({ kind: 'unsupported' })
  })

  it('scopes an answer by its own cover-letter question as well as the live one', () => {
    const letter = storedAnswer('Motivation letter', 'Letter for company A')
    const other = storedAnswer('Years of experience', '7', 'app-1')
    expect(answersForApplication([letter, other], 'Why do you want this role?', 'app-2')).toEqual([other])
    expect(answersForApplication([letter, other], 'Why do you want this role?', 'app-1')).toEqual([letter, other])
    expect(answersForApplication([letter, other], 'Cover letter', 'app-2')).toEqual([])
    expect(answersForApplication([other], 'Years of experience', null)).toEqual([other])
  })

  it('recognises cover-letter wording', () => {
    for (const label of ['Cover letter', 'Motivational letter', 'Letter of intent', 'Coverletter']) {
      expect(isCoverLetterQuestion(label)).toBe(true)
    }
    expect(isCoverLetterQuestion('Letter grade')).toBe(false)
  })

  it('stays unsupported without a stored answer, so the field is left unchanged', () => {
    for (const label of ['Cover letter', 'Motivation letter', 'Letter of interest']) {
      expect(fill(label, 'TextInput', profile([])).value).toEqual({ kind: 'unsupported' })
    }
  })

  it('still fills an explicit bio from the profile summary', () => {
    const result = fill('Short bio', 'TextInput', profile([]))
    expect(result.profileField).toBe('description')
    expect(result.value.kind === 'string' && result.value.value).toBe('Synthetic profile summary')
  })

  it('never routes the CV file to a cover-letter upload', () => {
    for (const label of ['Cover letter', 'Upload cover letter', 'Motivation letter', 'Letter of interest', 'CV / letter of interest', 'Resume and cover letter']) {
      expect(isCvFileRequest({ fieldName: label, fieldType: 'FileUpload' })).toBe(false)
      expect(fill(label, 'FileUpload', profile([])).value).toEqual({ kind: 'unsupported' })
    }
    expect(isCvFileRequest({ fieldName: 'Resume', fieldType: 'FileUpload' })).toBe(true)
  })
})

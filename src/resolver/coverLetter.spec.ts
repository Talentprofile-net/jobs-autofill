import { describe, expect, it } from 'bun:test'

import type { Profile, TalentAnswer } from '~/api/types'
import { fieldsWithoutProfileValue, mergeFillValues } from '~/bridge/fillValues'
import { isCvFileRequest } from './cvFile'
import { resolveLearnedAnswersBatch } from './learnedAnswers'
import { normalizeQuestion } from './normalizeQuestion'
import { resolveField } from './profileResolver'

const storedAnswer = (questionText: string, value: string): TalentAnswer =>
  ({
    answerKind: 'text',
    answerText: value,
    answerValue: { confidence: 'exact', kind: 'string', value },
    ats: 'generic',
    createdAt: '2026-09-01T00:00:00.000Z',
    fieldType: 'TextArea',
    id: 'cover-answer',
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
    talentJobApplicationId: null,
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

const fill = (fieldName: string, fieldType: string, p: Profile) => {
  const fields = [{ fieldName, fieldType, requestId: 'r1', section: '' }]
  const fromProfile = fields.map((f) => ({ requestId: f.requestId, ...resolveField(f.fieldName, f.fieldType, f.section, p) }))
  const learned = resolveLearnedAnswersBatch(fieldsWithoutProfileValue(fields, fromProfile), p, '_unknown')
  return mergeFillValues(fields, fromProfile, learned)[0]
}

describe('cover-letter questions through the fill-value pipeline', () => {
  it('falls through to a dedicated stored cover-letter answer', () => {
    const result = fill('Cover letter', 'TextInput', profile([storedAnswer('Cover letter', 'Saved cover letter text')]))
    expect(result).toEqual({ matchedAnswerId: 'cover-answer', profileField: null, requestId: 'r1', value: { confidence: 'exact', kind: 'string', value: 'Saved cover letter text' } })
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

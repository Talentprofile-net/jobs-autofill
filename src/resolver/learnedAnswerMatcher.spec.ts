import { describe, expect, it } from 'bun:test'

import { findLearnedAnswer } from './learnedAnswerMatcher'
import type { TalentAnswer } from '~/api/types'

// Stored answers carry the CORPUS field type; the live field being filled carries
// the ADAPTER type. Comparing them raw silently stopped every checkbox,
// multi-select, date, file and content-editable answer from matching — the fill
// forgot everything the user had taught it about those widgets, with no error
// anywhere.
//
// Two generations of rows exist: written before the vocabulary change (adapter
// names) and after (corpus names). Both must match the same live field.

const answer = (over: Partial<TalentAnswer> = {}): TalentAnswer =>
  ({
    answerKind: 'boolean',
    answerText: 'Yes',
    answerValue: { kind: 'boolean', value: true },
    ats: 'greenhouse',
    createdAt: '2026-08-01T00:00:00.000Z',
    fieldType: 'Checkbox',
    id: 'answer-1',
    labelEnumId: null,
    lastUsedAt: null,
    normalizedQuestion: 'do-you-require-visa-sponsorship',
    pageUrl: null,
    profileField: null,
    questionText: 'Do you require visa sponsorship?',
    resolverOutcome: 'filled',
    section: null,
    source: 'manual',
    sourceAnswerId: null,
    talentJobApplicationId: 'app-1',
    talentProfileId: 'talent-1',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  }) as TalentAnswer

const QUESTION = 'Do you require visa sponsorship?'

const match = (storedType: string, liveType: string) =>
  findLearnedAnswer(QUESTION, liveType, [answer({ fieldType: storedType })])

describe('matcher — corpus-stored answers match the live adapter field', () => {
  it.each([
    ['Checkbox', 'SingleCheckbox'],
    ['CheckboxGroup', 'MultiCheckbox'],
    ['DateInput', 'MonthYear'],
    ['DateInput', 'MonthDayYear'],
    ['DateInput', 'Year'],
    ['FileUpload', 'SingleFileUpload'],
    ['FileUpload', 'MultiFileUpload'],
    ['TextArea', 'ContentEditable'],
    ['SimpleDropdown', 'MultiSelect'],
    ['Combobox', 'MultiSearchableDropdown'],
    ['RadioGroup', 'BooleanRadio'],
    ['TextInput', 'TextInput'],
  ])('a stored %s answer fills a live %s field', (stored, live) => {
    expect(match(stored, live)?.answer.id).toBe('answer-1')
  })
})

describe('matcher — pre-existing rows keep working', () => {
  // Rows written before the vocabulary change carry adapter names.
  it.each([
    ['SingleCheckbox', 'SingleCheckbox'],
    ['MultiCheckbox', 'MultiCheckbox'],
    ['ContentEditable', 'ContentEditable'],
    ['MonthYear', 'MonthYear'],
  ])('a legacy %s answer still fills a live %s field', (stored, live) => {
    expect(match(stored, live)?.answer.id).toBe('answer-1')
  })

  // Free text is free text in both directions.
  it.each([
    ['TextInput', 'ContentEditable'],
    ['ContentEditable', 'TextInput'],
    ['TextArea', 'TextInput'],
  ])('a stored %s answer fills a live %s field', (stored, live) => {
    expect(match(stored, live)?.answer.id).toBe('answer-1')
  })
})

describe('matcher — incompatible widgets still do not match', () => {
  it.each([
    ['Checkbox', 'SimpleDropdown'],
    ['DateInput', 'TextInput'],
    ['FileUpload', 'SingleCheckbox'],
    ['CheckboxGroup', 'RadioGroup'],
  ])('a stored %s answer does not fill a live %s field', (stored, live) => {
    expect(match(stored, live)).toBeNull()
  })
})

describe('matcher — matching still needs the question to agree', () => {
  it('does not match a different question on a compatible widget', () => {
    const result = findLearnedAnswer(
      'What is your notice period?',
      'SingleCheckbox',
      [answer()],
    )

    expect(result).toBeNull()
  })

  it('returns nothing when there are no answers at all', () => {
    expect(findLearnedAnswer(QUESTION, 'SingleCheckbox', [])).toBeNull()
  })
})

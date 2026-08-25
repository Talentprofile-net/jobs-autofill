import { describe, expect, it } from 'bun:test'

import {
  toCorpusAnswerKind,
  toCorpusFieldType,
  type CorpusFieldType,
} from './corpusVocabulary'
import type { ProfileValue } from '~/field/types'

// The full adapter -> corpus equivalence table.
//
// Every row here is a claim about what the scrape worker would store for the
// same widget, and the worker is the authority:
//   fieldType  job-workers/src/queues/apply-form-training-data/field-extraction.ts
//   answerKind job-workers/src/queues/shared/normalization.ts normalizeAnswerKind
//
// If a row and the worker ever disagree, a captured answer and the corpus row
// describing the same question stop lining up, and the classifier trains on one
// while the predictor queries the other.

const YES_NO = ['Yes', 'No']
const AGREE = ['I agree', 'I do not agree']
const THREE = ['Germany', 'Thailand', 'United States']

const value = (kind: ProfileValue['kind']): ProfileValue => {
  switch (kind) {
    case 'boolean':
      return { kind: 'boolean', value: true }
    case 'choice':
      return { kind: 'choice', preferred: 'Yes', fallbacks: [] }
    case 'date':
      return { kind: 'date', year: '2026' }
    case 'multiChoice':
      return { kind: 'multiChoice', preferred: ['a'], fallbacks: [] }
    default:
      return { kind: 'string', value: 'x', confidence: 'exact' }
  }
}

describe('adapter fieldType -> corpus fieldType', () => {
  it.each<[string, CorpusFieldType]>([
    ['TextInput', 'TextInput'],
    ['ContentEditable', 'TextArea'],
    ['PasswordInput', 'TextInput'],
    ['SimpleDropdown', 'SimpleDropdown'],
    ['MultiSelect', 'SimpleDropdown'],
    ['MultiSearchableDropdown', 'Combobox'],
    ['RadioGroup', 'RadioGroup'],
    ['BooleanRadio', 'RadioGroup'],
    ['SingleCheckbox', 'Checkbox'],
    ['MultiCheckbox', 'CheckboxGroup'],
    ['SingleFileUpload', 'FileUpload'],
    ['MultiFileUpload', 'FileUpload'],
    ['MonthDayYear', 'DateInput'],
    ['MonthYear', 'DateInput'],
    ['Year', 'DateInput'],
  ])('maps %s to %s', (adapter, corpus) => {
    expect(toCorpusFieldType(adapter)).toBe(corpus)
  })

  it('maps an unrecognised adapter type to Unknown', () => {
    expect(toCorpusFieldType('SomeNewWidget')).toBe('Unknown')
  })

  // Old rows carry adapter names; new rows carry corpus names. The matcher
  // canonicalises both through this function, so a corpus name must be its own
  // fixed point or the two generations stop matching each other.
  it.each(['Checkbox', 'CheckboxGroup', 'Combobox', 'DateInput', 'FileUpload'])(
    'leaves the corpus name %s unchanged',
    (corpus) => {
      expect(toCorpusFieldType(corpus)).toBe(corpus)
    },
  )
})

describe('corpus answerKind — decided by field type alone', () => {
  it.each<[CorpusFieldType, string]>([
    ['FileUpload', 'file'],
    ['DateInput', 'date'],
    ['TextInput', 'text'],
    ['TextArea', 'text'],
    ['Checkbox', 'boolean'],
  ])('%s is always %s whatever the options say', (fieldType, kind) => {
    expect(toCorpusAnswerKind(fieldType, YES_NO, value('string'))).toBe(kind)
    expect(toCorpusAnswerKind(fieldType, null, value('string'))).toBe(kind)
  })
})

describe('corpus answerKind — decided by the option set', () => {
  // THE regression this table exists for. A dropdown offering Yes/No is
  // `boolean` in the corpus; reading the kind off the picked VALUE made it
  // `choice`, and the two never lined up.
  it.each<[CorpusFieldType, string[], string]>([
    ['SimpleDropdown', YES_NO, 'boolean'],
    ['SimpleDropdown', AGREE, 'boolean'],
    ['SimpleDropdown', THREE, 'choice'],
    ['RadioGroup', YES_NO, 'boolean'],
    ['RadioGroup', THREE, 'choice'],
    ['Combobox', YES_NO, 'boolean'],
    ['Combobox', THREE, 'choice'],
  ])('%s offering %j is %s', (fieldType, options, kind) => {
    expect(toCorpusAnswerKind(fieldType, options, value('choice'))).toBe(kind)
  })

  it('ignores placeholder options when sizing the set', () => {
    expect(
      toCorpusAnswerKind('SimpleDropdown', ['Select…', 'Yes', 'No'], value('choice')),
    ).toBe('boolean')
  })

  it('compares option labels after slugifying, not literally', () => {
    expect(
      toCorpusAnswerKind('RadioGroup', ['  I Agree  ', 'I do not agree'], value('choice')),
    ).toBe('boolean')
  })

  it.each<[string[], string]>([
    [['Only one'], 'boolean'],
    [YES_NO, 'multiChoice'],
    [THREE, 'multiChoice'],
  ])('a checkbox group offering %j is %s', (options, kind) => {
    expect(toCorpusAnswerKind('CheckboxGroup', options, value('multiChoice'))).toBe(
      kind,
    )
  })
})

describe('corpus answerKind — when the widget is unreadable', () => {
  // Custom ATS markup yields no options. Each fallback lands where the corpus
  // lands, which is not always where the widget "really" is.
  it.each<[CorpusFieldType, string]>([
    ['SimpleDropdown', 'choice'],
    ['RadioGroup', 'choice'],
    ['Combobox', 'choice'],
  ])('%s with no readable options is %s', (fieldType, kind) => {
    expect(toCorpusAnswerKind(fieldType, null, value('choice'))).toBe(kind)
  })

  // The one place the worker's own rule is deliberately NOT copied: it would
  // call an option-less CheckboxGroup `boolean`, which for a real multi-checkbox
  // is the single guess that is never right.
  it('reads an unreadable checkbox group off the captured value instead', () => {
    expect(toCorpusAnswerKind('CheckboxGroup', null, value('multiChoice'))).toBe(
      'multiChoice',
    )
    expect(toCorpusAnswerKind('CheckboxGroup', null, value('boolean'))).toBe(
      'boolean',
    )
  })
})

describe('corpus answerKind — end-to-end adapter pairs', () => {
  // Read as: this adapter, offering these options, must produce the pair the
  // scrape worker would have written for the same field.
  it.each<[string, null | string[], ProfileValue['kind'], string, string]>([
    ['TextInput', null, 'string', 'TextInput', 'text'],
    ['ContentEditable', null, 'string', 'TextArea', 'text'],
    ['SingleCheckbox', null, 'boolean', 'Checkbox', 'boolean'],
    ['MultiCheckbox', THREE, 'multiChoice', 'CheckboxGroup', 'multiChoice'],
    ['MultiCheckbox', null, 'multiChoice', 'CheckboxGroup', 'multiChoice'],
    ['SimpleDropdown', YES_NO, 'choice', 'SimpleDropdown', 'boolean'],
    ['SimpleDropdown', THREE, 'choice', 'SimpleDropdown', 'choice'],
    // A `<select multiple>` is one more `<select>` to the worker's extractor, so
    // the corpus calls it a choice however many the applicant ticks.
    ['MultiSelect', THREE, 'multiChoice', 'SimpleDropdown', 'choice'],
    ['MultiSearchableDropdown', null, 'multiChoice', 'Combobox', 'choice'],
    ['BooleanRadio', YES_NO, 'choice', 'RadioGroup', 'boolean'],
    ['RadioGroup', THREE, 'choice', 'RadioGroup', 'choice'],
    ['SingleFileUpload', null, 'string', 'FileUpload', 'file'],
    ['MultiFileUpload', null, 'multiChoice', 'FileUpload', 'file'],
    ['MonthYear', null, 'date', 'DateInput', 'date'],
    ['Year', null, 'date', 'DateInput', 'date'],
  ])(
    '%s with %j and a %s value stores (%s, %s)',
    (adapter, options, valueKind, expectedType, expectedKind) => {
      const corpusType = toCorpusFieldType(adapter)
      expect(corpusType).toBe(expectedType)
      expect(toCorpusAnswerKind(corpusType, options, value(valueKind))).toBe(
        expectedKind,
      )
    },
  )
})

import slugify from '@sindresorhus/slugify'

import type { ProfileValue } from '~/field/types'

// The extension and the scrape worker grew separate vocabularies for the same
// two columns, and nothing joined them, so an answer this extension captured
// could never line up with the corpus row describing the same question.
//
// The corpus vocabulary wins, because it is the one the classifier will be
// trained on: the `FieldType` union in
// job-workers/src/queues/apply-form-training-data/field-extraction.ts, and the
// `AnswerKind` in .../shared/normalization.ts. The extension's own names stay
// internal to the adapters, where they describe how to DRIVE a widget — a
// distinction the corpus does not make.
//
// Both halves must mirror the worker, not merely resemble it, and the second
// half is the one that was wrong: `answerKind` was read off the captured VALUE,
// while the worker derives it from the field's OPTION SET. That disagreed on
// every boolean-shaped dropdown and radio (worker `boolean`, extension
// `choice`) and on every multi-select (worker `choice`, extension
// `multiChoice`). corpusVocabulary.spec.ts holds the full equivalence table.
export type CorpusFieldType =
  | 'Checkbox'
  | 'CheckboxGroup'
  | 'Combobox'
  | 'DateInput'
  | 'FileUpload'
  | 'RadioGroup'
  | 'SimpleDropdown'
  | 'TextArea'
  | 'TextInput'
  | 'Unknown'

export type CorpusAnswerKind =
  | 'boolean'
  | 'choice'
  | 'date'
  | 'file'
  | 'multiChoice'
  | 'number'
  | 'text'

// Deliberately lossy, and never to be inverted. Two known gaps, recorded rather
// than papered over:
//
//  * The corpus separates `EmailInput`, `PhoneInput`, `UrlInput` and
//    `NumberInput` from `TextInput`; the extension drives all four with one text
//    adapter and cannot tell them apart after the fact. They land as
//    `TextInput`, so the corpus `number` kind is unreachable from here.
//  * A `<select multiple>` is `SimpleDropdown` to the worker — its extractor
//    classifies every `<select>` the same way — so a multi-select answer is
//    `choice`, not `multiChoice`. Matching the corpus matters more than
//    describing the widget.
const FIELD_TYPE_TO_CORPUS: Record<string, CorpusFieldType> = {
  BooleanRadio: 'RadioGroup',
  // Corpus names are their own fixed points. The matcher canonicalises BOTH the
  // stored answer and the live field through this map, and stored answers come in
  // two generations — rows written before the vocabulary change carry adapter
  // names, rows written after carry corpus names. Without these entries a
  // freshly stored `Checkbox` answer canonicalised to `Unknown` while the live
  // `SingleCheckbox` field canonicalised to `Checkbox`, so the new rows stopped
  // matching too — the exact breakage the vocabulary change set out to fix.
  Checkbox: 'Checkbox',
  CheckboxGroup: 'CheckboxGroup',
  Combobox: 'Combobox',
  ContentEditable: 'TextArea',
  DateInput: 'DateInput',
  FileUpload: 'FileUpload',
  MonthDayYear: 'DateInput',
  MonthYear: 'DateInput',
  MultiCheckbox: 'CheckboxGroup',
  MultiFileUpload: 'FileUpload',
  MultiSearchableDropdown: 'Combobox',
  MultiSelect: 'SimpleDropdown',
  PasswordInput: 'TextInput',
  RadioGroup: 'RadioGroup',
  SimpleDropdown: 'SimpleDropdown',
  SingleCheckbox: 'Checkbox',
  SingleFileUpload: 'FileUpload',
  TextArea: 'TextArea',
  TextInput: 'TextInput',
  Year: 'DateInput',
}

// Copied from job-workers/src/queues/shared/normalization.ts. Compared after
// slugify, so "I Agree" and "i-agree" are one entry.
const BOOLEAN_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['yes', 'no'],
  ['true', 'false'],
  ['agree', 'disagree'],
  ['accept', 'decline'],
  ['accept', 'reject'],
  ['okay', 'not-okay'],
  ['ok', 'not-ok'],
  ['i-agree', 'i-do-not-agree'],
  ['i-agree', 'i-disagree'],
  ['i-accept', 'i-decline'],
  ['enabled', 'disabled'],
  ['on', 'off'],
]

const TEXT_FIELD_TYPES = new Set<CorpusFieldType>(['TextArea', 'TextInput'])

// The worker drops placeholder entries before deciding, so "Select…" never
// counts toward the option set that makes a field boolean.
const PLACEHOLDER = /^(|-+|\.+|_+|n\/?a|select\b.*|please\s+(select|choose|pick|specify).*|choose\b.*|pick\s+(one|an?).*|make\s+a\s+selection|none\s+selected)$/i

const optionSlugs = (labels: null | string[]): string[] => {
  if (!labels) return []
  const slugs: string[] = []
  for (const label of labels) {
    const trimmed = label.trim()
    if (!trimmed || PLACEHOLDER.test(trimmed)) continue
    const slug = slugify(trimmed)
    if (slug) slugs.push(slug)
  }
  return slugs
}

const isBooleanOptionSet = (slugs: string[]): boolean => {
  if (slugs.length !== 2) return false
  const [a, b] = slugs
  return BOOLEAN_PAIRS.some(
    ([x, y]) => (a === x && b === y) || (a === y && b === x),
  )
}

export const toCorpusFieldType = (fieldType: string): CorpusFieldType =>
  FIELD_TYPE_TO_CORPUS[fieldType] ?? 'Unknown'

/**
 * `optionLabels` is null when the widget is custom markup this extension cannot
 * read generically. The fallbacks are chosen to land where the corpus lands:
 *
 *  * RadioGroup / SimpleDropdown / Combobox -> `choice`. The worker's own
 *    extractor stores NULL options for a `Combobox` unconditionally, so `choice`
 *    is what the corpus holds for one whatever its real options are.
 *  * CheckboxGroup -> read from the captured value instead, because the worker's
 *    rule ("one option or fewer means boolean") would turn an unreadable
 *    multi-checkbox into a boolean, which is the one guess that is never right.
 */
export const toCorpusAnswerKind = (
  corpusFieldType: CorpusFieldType,
  optionLabels: null | string[],
  value: ProfileValue,
): CorpusAnswerKind => {
  if (corpusFieldType === 'FileUpload') return 'file'
  if (corpusFieldType === 'DateInput') return 'date'
  if (TEXT_FIELD_TYPES.has(corpusFieldType)) return 'text'
  if (corpusFieldType === 'Checkbox') return 'boolean'

  const slugs = optionSlugs(optionLabels)

  if (corpusFieldType === 'CheckboxGroup') {
    if (slugs.length > 0) return slugs.length <= 1 ? 'boolean' : 'multiChoice'
    return value.kind === 'multiChoice' ? 'multiChoice' : 'boolean'
  }

  if (
    corpusFieldType === 'RadioGroup' ||
    corpusFieldType === 'SimpleDropdown' ||
    corpusFieldType === 'Combobox'
  ) {
    return isBooleanOptionSet(slugs) ? 'boolean' : 'choice'
  }

  // 'Unknown'. Mirrors the worker's own trailing branch.
  if (slugs.length === 0) return 'text'
  if (isBooleanOptionSet(slugs)) return 'boolean'
  if (slugs.length === 1) return 'boolean'
  return 'choice'
}

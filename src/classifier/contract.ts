export const INPUT_SERIALIZATION_VERSION = 'autofill-question-input.v1'
export const PREPROCESSING_SCHEMA_VERSION = 'preprocessing.v1'
export const POLICY_SCHEMA_VERSION = 'selective-policy.v1'
export const MASKED_LOGIT = -1.0e30

export const INPUT_TEMPLATE =
  'field type: {fieldType} | job country: {jobCountry} | question: {questionText}'

export const WHITESPACE_CHARACTERS =
  '\t\n\v\f\r    -     　﻿'

export type AnswerKind =
  | 'boolean'
  | 'choice'
  | 'multiChoice'
  | 'text'
  | 'number'
  | 'date'
  | 'file'

export type AbstentionReason =
  | 'unknown_question'
  | 'class_not_evaluable'
  | 'value_shape_mismatch'
  | 'country_mismatch'
  | 'low_margin'
  | 'low_confidence'
  | 'acceptance_disabled'

export const REASON_PRECEDENCE: readonly AbstentionReason[] = [
  'unknown_question',
  'class_not_evaluable',
  'value_shape_mismatch',
  'country_mismatch',
  'low_margin',
  'low_confidence',
  'acceptance_disabled',
]

export type CountryScopeReview = 'reviewed' | 'unreviewed'

export type LabelEntry = {
  index: number
  labelEnumId: string
  label: string
  valueShape: AnswerKind
  countryScope: string | null
  countryScopeReview: CountryScopeReview
}

export type LabelMap = {
  labelMapSchemaVersion: string
  labels: LabelEntry[]
}

export type SelectivePolicy = {
  policySchemaVersion: string
  calibrationMethod: 'temperature_scaling' | 'uncalibrated'
  temperature: number | null
  globalThreshold: number | null
  marginThreshold: number | null
  perClassThresholds: Record<string, number>
  blockedClasses: string[]
  maxUnknownTokenFraction: number | null
  automaticAcceptanceEnabled: boolean
}

export type ClassifierInput = {
  questionText: string
  fieldType: string
  jobCountry: string
}

export type DecisionContext = {
  answerKind: AnswerKind
  jobCountry: string
  unknownQuestion: boolean
}

export type Decision = {
  labelEnumId: string | null
  topLabelEnumId: string
  calibratedConfidence: number
  margin: number
  abstentionReason: AbstentionReason | null
  triggeredReasons: AbstentionReason[]
  modelVersion: string
}

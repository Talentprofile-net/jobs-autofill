import type { TalentAnswer } from '~/api/types'
import { toCorpusFieldType } from '~/capture/corpusVocabulary'
import { MAX_OPTIONS } from '~/capture/optionLabels'
import type { ProfileValue } from '~/field/types'
import {
  findLearnedAnswer,
  learnedAnswerToProfileValue,
  typesCompatible,
} from '~/resolver/learnedAnswerMatcher'
import type { AbstentionReason, AnswerKind, ClassifierInput, Decision } from './contract'
import { UNKNOWN_JOB_COUNTRY } from './jobCountry'

export type SuggestionRequest = {
  questionText: string
  fieldType: string
  optionLabels: string[]
  answerKind: AnswerKind
}

export type SuggestedAnswer = {
  id: string
  questionText: string
  answerText: string | null
}

export type Suggestion =
  | { status: 'disabled' }
  | { status: 'unavailable'; error: string }
  | {
      status: 'matched'
      method: 'normalized_text' | 'jaccard'
      answer: SuggestedAnswer
      value: ProfileValue
    }
  | {
      status: 'classified'
      method: 'classifier'
      labelEnumId: string
      label: string
      confidence: number
      answer: SuggestedAnswer | null
      value: ProfileValue | null
      jobCountry: string
      modelVersion: string
    }
  | {
      status: 'abstained'
      topLabelEnumId: string
      topLabel: string
      confidence: number
      reason: AbstentionReason
      jobCountry: string
      modelVersion: string
    }

export type ClassifyRequest = { input: ClassifierInput; answerKind: AnswerKind }

export type Classification = { decisions: Decision[]; runtimeId: string }

export type SuggestionDependencies = {
  classify: (requests: ClassifyRequest[]) => Promise<Classification>
  labelName: (labelEnumId: string) => Promise<string>
  answerLabels: (
    answers: TalentAnswer[],
    runtimeId: string,
  ) => Promise<Map<string, string | null>>
}

const summary = (answer: TalentAnswer): SuggestedAnswer => ({
  answerText: answer.answerText,
  id: answer.id,
  questionText: answer.questionText,
})

const time = (value: string | null): number => {
  const parsed = value === null ? Number.NaN : Date.parse(value)
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
}

export const newestAnswerFirst = (a: TalentAnswer, b: TalentAnswer): number =>
  time(b.lastUsedAt ?? b.updatedAt) - time(a.lastUsedAt ?? a.updatedAt) ||
  time(b.updatedAt) - time(a.updatedAt) ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

const ANSWER_KINDS: ReadonlySet<string> = new Set<AnswerKind>([
  'boolean',
  'choice',
  'date',
  'file',
  'multiChoice',
  'number',
  'text',
])

const isAnswerKind = (value: string): value is AnswerKind => ANSWER_KINDS.has(value)

const filled = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

export const isUsableValue = (value: ProfileValue): boolean => {
  if (value.kind === 'string') return filled(value.value)
  if (value.kind === 'choice') return filled(value.preferred)
  if (value.kind === 'multiChoice') {
    return Array.isArray(value.preferred) && value.preferred.length > 0 && value.preferred.every(filled)
  }
  if (value.kind === 'boolean') return typeof value.value === 'boolean'
  if (value.kind === 'date') return filled(value.year)
  return false
}

export const SUGGESTION_REQUEST_LIMITS = {
  fieldType: 64,
  optionLabel: 4_096,
  optionLabels: MAX_OPTIONS,
  optionText: 65_536,
  questionText: 4_096,
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const readSuggestionRequest = (value: unknown): SuggestionRequest | null => {
  if (!isRecord(value)) return null
  const { answerKind, fieldType, optionLabels, questionText } = value
  const limits = SUGGESTION_REQUEST_LIMITS
  if (typeof answerKind !== 'string' || !isAnswerKind(answerKind)) return null
  if (typeof fieldType !== 'string' || fieldType.length === 0 || fieldType.length > limits.fieldType) {
    return null
  }
  if (typeof questionText !== 'string' || questionText.length > limits.questionText) return null
  if (!Array.isArray(optionLabels) || optionLabels.length > limits.optionLabels) return null
  const labels: string[] = []
  let optionText = 0
  for (const label of optionLabels) {
    if (typeof label !== 'string' || label.length > limits.optionLabel) return null
    optionText += label.length
    if (optionText > limits.optionText) return null
    labels.push(label)
  }
  return { answerKind, fieldType, optionLabels: labels, questionText }
}

export const answerClassifierRequest = (answer: TalentAnswer): ClassifyRequest | null =>
  isAnswerKind(answer.answerKind)
    ? {
        answerKind: answer.answerKind,
        input: {
          fieldType: toCorpusFieldType(answer.fieldType),
          jobCountry: UNKNOWN_JOB_COUNTRY,
          optionLabels: [],
          questionText: answer.questionText,
        },
      }
    : null

export const suggestAnswer = async (
  request: SuggestionRequest,
  answers: TalentAnswer[],
  jobCountry: string,
  dependencies: SuggestionDependencies,
): Promise<Suggestion> => {
  const match = findLearnedAnswer(request.questionText, request.fieldType, answers)
  if (match && match.method !== 'classifier') {
    const value = learnedAnswerToProfileValue(match, request.fieldType)
    if (isUsableValue(value)) {
      return { answer: summary(match.answer), method: match.method, status: 'matched', value }
    }
  }
  const classification = await dependencies.classify([
    {
      answerKind: request.answerKind,
      input: {
        fieldType: toCorpusFieldType(request.fieldType),
        jobCountry,
        optionLabels: request.optionLabels,
        questionText: request.questionText,
      },
    },
  ])
  const [decision] = classification.decisions
  if (!decision) return { error: 'the classifier returned no decision', status: 'unavailable' }
  if (decision.labelEnumId === null) {
    return {
      confidence: decision.calibratedConfidence,
      jobCountry,
      modelVersion: decision.modelVersion,
      reason: decision.abstentionReason ?? 'low_confidence',
      status: 'abstained',
      topLabel: await dependencies.labelName(decision.topLabelEnumId),
      topLabelEnumId: decision.topLabelEnumId,
    }
  }
  const labelEnumId = decision.labelEnumId
  const compatible = answers.filter((answer) => typesCompatible(answer.fieldType, request.fieldType))
  const labels = await dependencies.answerLabels(compatible, classification.runtimeId)
  const candidates = compatible
    .filter((answer) => labels.get(answer.id) === labelEnumId)
    .sort(newestAnswerFirst)
  const chosen = candidates
    .map((answer) => ({
      answer,
      value: learnedAnswerToProfileValue(
        { answer, method: 'classifier', score: decision.calibratedConfidence },
        request.fieldType,
      ),
    }))
    .find((candidate) => isUsableValue(candidate.value))
  return {
    answer: chosen ? summary(chosen.answer) : null,
    confidence: decision.calibratedConfidence,
    jobCountry,
    label: await dependencies.labelName(labelEnumId),
    labelEnumId,
    method: 'classifier',
    modelVersion: decision.modelVersion,
    status: 'classified',
    value: chosen ? chosen.value : null,
  }
}

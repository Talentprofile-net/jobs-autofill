import type { TalentAnswer } from '~/api/types'
import { serializeInput } from './preprocess'
import { answerClassifierRequest, type Classification, type ClassifyRequest } from './suggest'

export type AnswerLabelStorage = {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

type Entry = { revision: string; input: string; labelEnumId: string | null }
type Cache = { runtimeId: string; entries: Record<string, Entry> }

export const ANSWER_LABELS_KEY = 'tp.classifier.answerLabels'

const isCache = (value: unknown): value is Cache =>
  typeof value === 'object' &&
  value !== null &&
  'runtimeId' in value &&
  typeof value.runtimeId === 'string' &&
  'entries' in value &&
  typeof value.entries === 'object' &&
  value.entries !== null

export const classifierInputKey = (request: ClassifyRequest | null): string =>
  request ? `${request.answerKind}\u0000${serializeInput(request.input)}` : ''

export const createAnswerLabels =
  (
    storage: AnswerLabelStorage,
    classify: (requests: ClassifyRequest[]) => Promise<Classification>,
  ) =>
  async (answers: TalentAnswer[], runtimeId: string): Promise<Map<string, string | null>> => {
    const stored = (await storage.get(ANSWER_LABELS_KEY))[ANSWER_LABELS_KEY]
    const entries: Record<string, Entry> =
      isCache(stored) && stored.runtimeId === runtimeId ? { ...stored.entries } : {}
    const keyed = answers.map((answer) => {
      const request = answerClassifierRequest(answer)
      return { answer, input: classifierInputKey(request), request }
    })
    const missing = keyed.filter(({ answer, input }) => {
      const entry = entries[answer.id]
      return entry?.revision !== answer.updatedAt || entry.input !== input
    })
    const classifiable = missing.filter(
      (item): item is (typeof missing)[number] & { request: ClassifyRequest } => item.request !== null,
    )
    if (classifiable.length) {
      const result = await classify(classifiable.map((item) => item.request))
      if (result.runtimeId !== runtimeId || result.decisions.length !== classifiable.length) {
        throw new Error('the classifier runtime changed during the request')
      }
      classifiable.forEach((item, index) => {
        entries[item.answer.id] = {
          input: item.input,
          labelEnumId: result.decisions[index].labelEnumId,
          revision: item.answer.updatedAt,
        }
      })
    }
    for (const item of missing) {
      if (item.request === null) {
        entries[item.answer.id] = { input: item.input, labelEnumId: null, revision: item.answer.updatedAt }
      }
    }
    if (missing.length) await storage.set({ [ANSWER_LABELS_KEY]: { entries, runtimeId } })
    return new Map(answers.map((answer) => [answer.id, entries[answer.id]?.labelEnumId ?? null]))
  }

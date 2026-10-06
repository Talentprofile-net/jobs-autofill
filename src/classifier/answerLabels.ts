import type { TalentAnswer } from '~/api/types'
import { serializeInput } from './preprocess'
import { answerClassifierRequest, newestAnswerFirst, type Classification, type ClassifyRequest } from './suggest'

export type AnswerLabelStorage = {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

type Entry = { revision: string; input: string; labelEnumId: string | null }
type Cache = { runtimeId: string; entries: Record<string, Entry> }

export type AnswerLabelStop = (answer: TalentAnswer, labelEnumId: string | null) => boolean

export const ANSWER_LABELS_KEY = 'tp.classifier.answerLabels'
export const ANSWER_LABEL_CHUNK = 8

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

const nextTask = (): Promise<void> => new Promise((done) => setTimeout(done, 0))

export const createAnswerLabels =
  (
    storage: AnswerLabelStorage,
    classify: (requests: ClassifyRequest[]) => Promise<Classification>,
    pause: () => Promise<void> = nextTask,
  ) =>
  async (
    answers: TalentAnswer[],
    runtimeId: string,
    jobCountry: string,
    stop: AnswerLabelStop = () => false,
  ): Promise<Map<string, string | null>> => {
    const stored = (await storage.get(ANSWER_LABELS_KEY))[ANSWER_LABELS_KEY]
    const entries: Record<string, Entry> =
      isCache(stored) && stored.runtimeId === runtimeId ? { ...stored.entries } : {}
    const ordered = [...answers].sort(newestAnswerFirst).map((answer) => {
      const request = answerClassifierRequest(answer, jobCountry)
      return { answer, input: classifierInputKey(request), request }
    })
    const known = ({ answer, input }: (typeof ordered)[number]) => {
      const entry = entries[answer.id]
      return entry?.revision === answer.updatedAt && entry.input === input
    }
    const labels = () =>
      new Map(
        ordered.filter(known).map(({ answer }) => [answer.id, entries[answer.id].labelEnumId] as const),
      )
    let changed = false
    let cursor = 0
    let classified = false
    for (;;) {
      while (cursor < ordered.length) {
        const item = ordered[cursor]
        if (!known(item)) {
          if (item.request !== null) break
          entries[item.answer.id] = { input: item.input, labelEnumId: null, revision: item.answer.updatedAt }
          changed = true
        }
        if (stop(item.answer, entries[item.answer.id].labelEnumId)) cursor = ordered.length
        cursor += 1
      }
      if (cursor >= ordered.length) break
      const chunk = ordered
        .slice(cursor)
        .filter((item): item is (typeof ordered)[number] & { request: ClassifyRequest } =>
          item.request !== null && !known(item),
        )
        .slice(0, ANSWER_LABEL_CHUNK)
      if (classified) await pause()
      const result = await classify(chunk.map((item) => item.request))
      classified = true
      if (result.runtimeId !== runtimeId || result.decisions.length !== chunk.length) {
        throw new Error('the classifier runtime changed during the request')
      }
      chunk.forEach((item, index) => {
        entries[item.answer.id] = {
          input: item.input,
          labelEnumId: result.decisions[index].labelEnumId,
          revision: item.answer.updatedAt,
        }
      })
      await storage.set({ [ANSWER_LABELS_KEY]: { entries: { ...entries }, runtimeId } })
      changed = false
    }
    if (changed) await storage.set({ [ANSWER_LABELS_KEY]: { entries: { ...entries }, runtimeId } })
    return labels()
  }

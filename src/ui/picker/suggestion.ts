import { toCorpusAnswerKind, toCorpusFieldType } from '~/capture/corpusVocabulary'
import { readOptionLabels } from '~/capture/optionLabels'
import type { SuggestionRequest } from '~/classifier/suggest'
import type { SuggestionRow } from '~/classifier/suggestClient'

export type FieldSuggestion = { fieldUuid: string; row: SuggestionRow }

export const suggestionRequestFor = (ctx: {
  field: HTMLElement
  fieldName: string
  fieldType: string
}): SuggestionRequest => {
  const optionLabels = readOptionLabels(ctx.field)
  return {
    answerKind: toCorpusAnswerKind(toCorpusFieldType(ctx.fieldType), optionLabels, {
      kind: 'unsupported',
    }),
    fieldType: ctx.fieldType,
    optionLabels: optionLabels ?? [],
    questionText: ctx.fieldName,
  }
}

export const createSuggestionLoader = (
  request: (request: SuggestionRequest) => Promise<SuggestionRow | null>,
  show: (suggestion: FieldSuggestion | null) => void,
) => {
  let latest = 0
  let closed = false
  return {
    close: (): void => {
      closed = true
      latest += 1
    },
    load: async (fieldUuid: string, build: () => SuggestionRequest): Promise<void> => {
      if (closed) return
      const ticket = ++latest
      show(null)
      const row = await Promise.resolve()
        .then(() => request(build()))
        .catch(() => null)
      if (closed || ticket !== latest) return
      show(row ? { fieldUuid, row } : null)
    },
  }
}

export const rowForField = (
  suggestion: FieldSuggestion | null,
  fieldUuid: string,
): SuggestionRow | null => (suggestion?.fieldUuid === fieldUuid ? suggestion.row : null)

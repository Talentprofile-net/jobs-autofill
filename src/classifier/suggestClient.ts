import type { ProfileValue } from '~/field/types'
import { readSuggestionRequest, type Suggestion, type SuggestionRequest } from './suggest'
import { readClassifierSuggestions, type SwitchStorage } from './suggestionSwitch'

type Response = { ok: true; data?: Suggestion } | { ok: false; error: string }

export type SuggestMessage = { kind: 'classifier.suggest'; request: SuggestionRequest }

export type SuggestionRow = {
  title: string
  value: ProfileValue
}

export const requestSuggestionFromBackground = async (
  send: (message: SuggestMessage) => Promise<Response>,
  request: SuggestionRequest,
): Promise<Suggestion> => {
  const message: SuggestMessage = { kind: 'classifier.suggest', request }
  let response = await send(message)
  if (!response.ok) response = await send(message)
  if (response.ok && response.data) return response.data
  return { error: response.ok ? 'no suggestion' : response.error, status: 'unavailable' }
}

const valueText = (value: ProfileValue): string => {
  if (value.kind === 'string') return value.value
  if (value.kind === 'choice') return value.preferred
  if (value.kind === 'multiChoice') return value.preferred.join(', ')
  if (value.kind === 'boolean') return value.value ? 'Yes' : 'No'
  if (value.kind === 'date') return [value.year, value.month, value.day].filter(Boolean).join('-')
  return ''
}

const row = (answerText: string | null, value: ProfileValue): SuggestionRow | null => {
  const title = answerText?.trim() || valueText(value).trim()
  return title ? { title, value } : null
}

export const describeSuggestion = (suggestion: Suggestion | null): SuggestionRow | null => {
  if (suggestion?.status === 'matched') return row(suggestion.answer.answerText, suggestion.value)
  if (suggestion?.status === 'classified' && suggestion.answer && suggestion.value) {
    return row(suggestion.answer.answerText, suggestion.value)
  }
  return null
}

export const requestSuggestionRow = async (
  send: (message: SuggestMessage) => Promise<Response>,
  switchStorage: SwitchStorage,
  raw: unknown,
): Promise<SuggestionRow | null> => {
  const request = readSuggestionRequest(raw)
  if (!request || !(await readClassifierSuggestions(switchStorage))) return null
  return describeSuggestion(await requestSuggestionFromBackground(send, request))
}

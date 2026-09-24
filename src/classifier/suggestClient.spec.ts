import { describe, expect, it } from 'bun:test'

import type { Suggestion } from './suggest'
import {
  describeSuggestion,
  requestSuggestionFromBackground,
  requestSuggestionRow,
  type SuggestMessage,
} from './suggestClient'

const request = { answerKind: 'text' as const, fieldType: 'TextInput', optionLabels: [], questionText: 'Degree' }
const value = { confidence: 'guess' as const, kind: 'string' as const, value: 'MSc' }
const answer = { answerText: 'MSc', id: 'a', questionText: 'Degree' }

const classified = (over: Partial<Extract<Suggestion, { status: 'classified' }>> = {}): Suggestion => ({
  answer,
  confidence: 0.972,
  jobCountry: 'DE',
  label: 'education_level_text',
  labelEnumId: 'x',
  method: 'classifier',
  modelVersion: 'candidate-model',
  status: 'classified',
  value,
  ...over,
})

const switchStorage = (enabled: boolean) => ({
  get: async (key: string) => ({ [key]: enabled }),
  set: async () => {},
})

describe('suggestion request from a content script', () => {
  it('asks again once when the service worker dropped the first request', async () => {
    const seen: SuggestMessage[] = []
    const replies = [
      { error: 'The message port closed before a response was received.', ok: false as const },
      { data: { status: 'disabled' as const }, ok: true as const },
    ]
    const result = await requestSuggestionFromBackground(async (message) => {
      seen.push(message)
      return replies[seen.length - 1] ?? { error: 'unexpected', ok: false }
    }, request)

    expect(result).toEqual({ status: 'disabled' })
    expect(seen).toHaveLength(2)
  })

  it('reports the second failure instead of retrying forever', async () => {
    let calls = 0
    const result = await requestSuggestionFromBackground(async () => {
      calls += 1
      return { error: 'gone', ok: false }
    }, request)

    expect(result).toEqual({ error: 'gone', status: 'unavailable' })
    expect(calls).toBe(2)
  })
})

describe('suggestion row crossing into the page', () => {
  it('sends nothing to the background while the switch is off', async () => {
    let calls = 0
    const row = await requestSuggestionRow(
      async () => {
        calls += 1
        return { data: classified(), ok: true }
      },
      switchStorage(false),
      request,
    )

    expect(row).toBeNull()
    expect(calls).toBe(0)
  })

  it('drops a malformed page request before it reaches the background', async () => {
    let calls = 0
    const send = async () => {
      calls += 1
      return { data: classified(), ok: true as const }
    }

    expect(await requestSuggestionRow(send, switchStorage(true), { ...request, optionLabels: [1] })).toBeNull()
    expect(await requestSuggestionRow(send, switchStorage(true), 'Degree')).toBeNull()
    expect(calls).toBe(0)
  })

  it('carries only the title and fill value of a linked saved answer', async () => {
    const row = await requestSuggestionRow(
      async () => ({ data: classified(), ok: true }),
      switchStorage(true),
      request,
    )

    expect(row).toEqual({ title: 'MSc', value })
    expect(Object.keys(row ?? {}).sort()).toEqual(['title', 'value'])
    const text = JSON.stringify(row)
    for (const internal of ['education_level_text', '0.972', 'candidate-model', 'DE', 'classifier', '"x"']) {
      expect(text.includes(internal)).toBe(false)
    }
  })

  it('turns a transport failure into no row, with no error text', async () => {
    const row = await requestSuggestionRow(
      async () => ({ error: 'the classifier disconnected', ok: false }),
      switchStorage(true),
      request,
    )

    expect(row).toBeNull()
  })
})

describe('picker suggestion row', () => {
  it('shows nothing while the switch is off or nothing came back', () => {
    expect(describeSuggestion({ status: 'disabled' })).toBeNull()
    expect(describeSuggestion(null)).toBeNull()
  })

  it('shows nothing for a failure', () => {
    expect(describeSuggestion({ error: 'the classifier disconnected', status: 'unavailable' })).toBeNull()
  })

  it('shows nothing for an abstention', () => {
    expect(
      describeSuggestion({
        confidence: 0.61,
        jobCountry: 'DE',
        modelVersion: 'm',
        reason: 'low_confidence',
        status: 'abstained',
        topLabel: 'education_level_text',
        topLabelEnumId: 'x',
      }),
    ).toBeNull()
  })

  it('shows nothing for an accepted label without a saved answer to fill', () => {
    expect(describeSuggestion(classified({ answer: null, value: null }))).toBeNull()
  })

  it('shows only the saved answer the classifier linked', () => {
    expect(describeSuggestion(classified())).toEqual({ title: 'MSc', value })
  })

  it('titles a row without answer text by the value it fills, never by the stored question', () => {
    const choice = { fallbacks: [], kind: 'choice' as const, preferred: 'Germany' }
    const row = describeSuggestion(classified({ answer: { ...answer, answerText: null }, value: choice }))

    expect(row).toEqual({ title: 'Germany', value: choice })
  })

  it('shows no row when there is nothing to title it with', () => {
    const empty = { confidence: 'guess' as const, kind: 'string' as const, value: ' ' }

    expect(describeSuggestion(classified({ answer: { ...answer, answerText: ' ' }, value: empty }))).toBeNull()
  })

  it('shows a saved answer found by question text', () => {
    expect(describeSuggestion({ answer, method: 'jaccard', status: 'matched', value })).toEqual({
      title: 'MSc',
      value,
    })
  })
})

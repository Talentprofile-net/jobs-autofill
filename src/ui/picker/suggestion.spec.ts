import { describe, expect, it } from 'bun:test'

import type { SuggestionRequest } from '~/classifier/suggest'
import type { SuggestionRow } from '~/classifier/suggestClient'
import { createSuggestionLoader, rowForField, type FieldSuggestion } from './suggestion'

const value = { confidence: 'guess' as const, kind: 'string' as const, value: 'MSc' }
const request: SuggestionRequest = {
  answerKind: 'text',
  fieldType: 'TextInput',
  optionLabels: [],
  questionText: 'Degree',
}

const deferred = () => {
  let resolve: (row: SuggestionRow | null) => void = () => {}
  const promise = new Promise<SuggestionRow | null>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const tick = () => new Promise((done) => setTimeout(done, 0))

const harness = () => {
  const replies: ReturnType<typeof deferred>[] = []
  const shown: Array<FieldSuggestion | null> = []
  const loader = createSuggestionLoader(
    () => {
      const reply = deferred()
      replies.push(reply)
      return reply.promise
    },
    (next) => shown.push(next),
  )
  return { loader, replies, shown }
}

describe('picker suggestion lifecycle', () => {
  it('shows the row bound to the field it was asked for', async () => {
    const { loader, replies, shown } = harness()
    const loading = loader.load('field-1', () => request)
    await tick()
    replies[0]?.resolve({ title: 'MSc', value })
    await loading

    expect(shown).toEqual([null, { fieldUuid: 'field-1', row: { title: 'MSc', value } }])
  })

  it('drops a late answer to an older request', async () => {
    const { loader, replies, shown } = harness()
    const first = loader.load('field-1', () => request)
    const second = loader.load('field-1', () => request)
    await tick()
    replies[1]?.resolve({ title: 'new', value })
    await second
    replies[0]?.resolve({ title: 'old', value })
    await first

    expect(shown.at(-1)).toEqual({ fieldUuid: 'field-1', row: { title: 'new', value } })
    expect(shown.some((item) => item?.row.title === 'old')).toBe(false)
  })

  it('drops an answer that arrives after the picker closed', async () => {
    const { loader, replies, shown } = harness()
    const loading = loader.load('field-1', () => request)
    await tick()
    loader.close()
    replies[0]?.resolve({ title: 'MSc', value })
    await loading
    await loader.load('field-1', () => request)

    expect(shown).toEqual([null])
    expect(replies).toHaveLength(1)
  })

  it('shows no row when building the request or the request itself fails', async () => {
    const shown: Array<FieldSuggestion | null> = []
    const failing = createSuggestionLoader(
      () => Promise.reject(new Error('bridge gone')),
      (next) => shown.push(next),
    )
    await failing.load('field-1', () => request)
    await failing.load('field-1', () => {
      throw new Error('detached field')
    })

    expect(shown).toEqual([null, null, null, null])
  })

  it('never offers one field the row fetched for another', () => {
    const suggestion = { fieldUuid: 'field-1', row: { title: 'MSc', value } }

    expect(rowForField(suggestion, 'field-1')).toEqual({ title: 'MSc', value })
    expect(rowForField(suggestion, 'field-2')).toBeNull()
    expect(rowForField(null, 'field-1')).toBeNull()
  })
})

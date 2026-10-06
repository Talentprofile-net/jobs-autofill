import { describe, expect, it } from 'bun:test'

import { ANSWER_LABEL_CHUNK, ANSWER_LABELS_KEY, createAnswerLabels } from './answerLabels'
import type { Decision } from './contract'
import type { ClassifyRequest } from './suggest'
import { talentAnswer } from './testAnswers'

const memory = () => {
  const values: Record<string, unknown> = {}
  return {
    get: async (key: string) => ({ [key]: values[key] }),
    set: async (items: Record<string, unknown>) => {
      Object.assign(values, items)
    },
    values,
  }
}

const classifier = (runtimeId = 'runtime-1') => {
  const calls: ClassifyRequest[][] = []
  const classify = async (requests: ClassifyRequest[]) => {
    calls.push(requests)
    return {
      decisions: requests.map((request) => ({
        abstentionReason: null,
        calibratedConfidence: 0.99,
        labelEnumId: `label:${request.input.questionText}`,
        margin: 0.9,
        modelVersion: 'model-1',
        topLabelEnumId: `label:${request.input.questionText}`,
        triggeredReasons: [],
      })),
      runtimeId,
    }
  }
  return { calls, classify }
}

describe('stored answer labels', () => {
  it('classifies a saved answer with the current form country, not its stored country', async () => {
    const { calls, classify } = classifier()
    await createAnswerLabels(memory(), classify)([talentAnswer({ jobCountry: 'DE' })], 'runtime-1', 'US')

    expect(calls[0]?.[0]).toEqual({
      answerKind: 'text',
      input: {
        fieldType: 'TextInput',
        jobCountry: 'US',
        optionLabels: [],
        questionText: 'Highest degree obtained',
      },
    })
  })

  it.each([
    ['a known country', 'GB'],
    ['the unknown country', '_unknown'],
  ])('passes %s to the classifier unchanged', async (_, country) => {
    const { calls, classify } = classifier()
    await createAnswerLabels(memory(), classify)(
      [talentAnswer({ jobCountry: 'DE' }), talentAnswer({ id: 'answer-2', jobCountry: null })],
      'runtime-1',
      country,
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]?.map((request) => [request.input.jobCountry, request.input.optionLabels])).toEqual([
      [country, []],
      [country, []],
    ])
  })

  it('reuses the label for the same country and reclassifies for another without a new revision', async () => {
    const storage = memory()
    const { calls, classify } = classifier()
    const labels = createAnswerLabels(storage, classify)
    const answer = talentAnswer({ jobCountry: 'DE' })

    const first = await labels([answer], 'runtime-1', 'US')
    const same = await labels([answer], 'runtime-1', 'US')
    const other = await labels([answer], 'runtime-1', 'GB')

    expect(first.get('answer-1')).toBe('label:Highest degree obtained')
    expect(same.get('answer-1')).toBe('label:Highest degree obtained')
    expect(other.get('answer-1')).toBe('label:Highest degree obtained')
    expect(calls.map((call) => call.map((request) => request.input.jobCountry))).toEqual([['US'], ['GB']])
    expect(storage.values[ANSWER_LABELS_KEY]).toEqual({
      entries: {
        'answer-1': {
          input: 'text\u0000field type: TextInput | job country: GB | question: Highest degree obtained',
          labelEnumId: 'label:Highest degree obtained',
          revision: '2026-08-01T00:00:00.000Z',
        },
      },
      runtimeId: 'runtime-1',
    })
  })

  it('treats a label cached under _unknown as stale once the country is known', async () => {
    const storage = memory()
    const { calls, classify } = classifier()
    const labels = createAnswerLabels(storage, classify)

    await labels([talentAnswer()], 'runtime-1', '_unknown')
    await labels([talentAnswer()], 'runtime-1', 'US')

    expect(calls.map((call) => call[0]?.input.jobCountry)).toEqual(['_unknown', 'US'])
  })

  it('keeps an abstained stored-answer label as null and does not reclassify it for the same country', async () => {
    const storage = memory()
    const calls: ClassifyRequest[][] = []
    const abstained: Decision = {
      abstentionReason: 'low_confidence',
      calibratedConfidence: 0.2,
      labelEnumId: null,
      margin: 0.01,
      modelVersion: 'model-1',
      topLabelEnumId: 'label-any',
      triggeredReasons: ['low_confidence'],
    }
    const abstaining = async (requests: ClassifyRequest[]) => {
      calls.push(requests)
      return { decisions: requests.map(() => abstained), runtimeId: 'runtime-1' }
    }
    const labels = createAnswerLabels(storage, abstaining)

    const first = await labels([talentAnswer()], 'runtime-1', 'US')
    const again = await labels([talentAnswer()], 'runtime-1', 'US')

    expect(first.get('answer-1')).toBeNull()
    expect(again.get('answer-1')).toBeNull()
    expect(calls).toHaveLength(1)
  })

  it('classifies each stored answer once per revision and runtime', async () => {
    const storage = memory()
    const { calls, classify } = classifier()
    const labels = createAnswerLabels(storage, classify)
    const answer = talentAnswer()

    await labels([answer], 'runtime-1', '_unknown')
    const again = await labels([answer], 'runtime-1', '_unknown')
    await labels([{ ...answer, updatedAt: '2026-09-01T00:00:00.000Z' }], 'runtime-1', '_unknown')

    expect(again.get('answer-1')).toBe('label:Highest degree obtained')
    expect(calls).toHaveLength(2)
    expect(calls[0]?.[0]?.input.jobCountry).toBe('_unknown')
    expect(calls[0]?.[0]?.input.optionLabels).toEqual([])
  })

  it('reclassifies an answer whose classifier input changed without a new revision', async () => {
    const storage = memory()
    const { calls, classify } = classifier()
    const labels = createAnswerLabels(storage, classify)

    await labels([talentAnswer()], 'runtime-1', '_unknown')
    const edited = await labels([talentAnswer({ questionText: 'Highest education level' })], 'runtime-1', '_unknown')
    await labels([talentAnswer({ fieldType: 'TextArea', questionText: 'Highest education level' })], 'runtime-1', '_unknown')

    expect(calls).toHaveLength(3)
    expect(edited.get('answer-1')).toBe('label:Highest education level')
  })

  it('reclassifies everything for another runtime identity', async () => {
    const storage = memory()
    const first = classifier('runtime-1')
    await createAnswerLabels(storage, first.classify)([talentAnswer()], 'runtime-1', '_unknown')
    const second = classifier('runtime-2')
    await createAnswerLabels(storage, second.classify)([talentAnswer()], 'runtime-2', '_unknown')

    expect(second.calls).toHaveLength(1)
    expect(storage.values[ANSWER_LABELS_KEY]).toEqual({
      entries: {
        'answer-1': {
          input: 'text\u0000field type: TextInput | job country: _unknown | question: Highest degree obtained',
          labelEnumId: 'label:Highest degree obtained',
          revision: '2026-08-01T00:00:00.000Z',
        },
      },
      runtimeId: 'runtime-2',
    })
  })

  it('ignores a cache written in the old model-version-only shape', async () => {
    const storage = memory()
    storage.values[ANSWER_LABELS_KEY] = {
      entries: { 'answer-1': { labelEnumId: 'stale', updatedAt: '2026-08-01T00:00:00.000Z' } },
      modelVersion: 'runtime-1',
    }
    const { calls, classify } = classifier()
    const labels = await createAnswerLabels(storage, classify)([talentAnswer()], 'runtime-1', '_unknown')

    expect(calls).toHaveLength(1)
    expect(labels.get('answer-1')).toBe('label:Highest degree obtained')
  })

  it('refuses labels from a runtime other than the one that classified the field', async () => {
    const storage = memory()
    const { classify } = classifier('runtime-2')

    const error = await createAnswerLabels(storage, classify)([talentAnswer()], 'runtime-1', '_unknown').then(
      () => null,
      (failure: Error) => failure.message,
    )

    expect(error).toBe('the classifier runtime changed during the request')
    expect(ANSWER_LABELS_KEY in storage.values).toBe(false)
  })

  it('never sends a stored answer with an unknown answer kind', async () => {
    const { calls, classify } = classifier()
    const result = await createAnswerLabels(memory(), classify)(
      [talentAnswer({ answerKind: 'legacy' })],
      'runtime-1',
      '_unknown',
    )

    expect(calls).toHaveLength(0)
    expect(result.get('answer-1')).toBeNull()
  })
})

describe('bounded stored-answer scheduling', () => {
  const dated = (index: number, over: Parameters<typeof talentAnswer>[0] = {}) =>
    talentAnswer({
      id: `answer-${index}`,
      questionText: `Question ${index}`,
      updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      ...over,
    })
  const many = (count: number) => Array.from({ length: count }, (_, index) => dated(index))
  const recording = () => {
    const values: Record<string, unknown> = {}
    const writes: number[] = []
    return {
      get: async (key: string) => ({ [key]: values[key] }),
      set: async (items: Record<string, unknown>) => {
        Object.assign(values, items)
        const cache = items[ANSWER_LABELS_KEY] as { entries: Record<string, unknown> }
        writes.push(Object.keys(cache.entries).length)
      },
      values,
      writes,
    }
  }

  it('classifies uncached answers newest first in chunks of at most the chunk size', async () => {
    const { calls, classify } = classifier()
    const labels = await createAnswerLabels(memory(), classify, async () => {})(many(20), 'runtime-1', 'US')

    expect(ANSWER_LABEL_CHUNK).toBe(8)
    expect(calls.map((call) => call.length)).toEqual([8, 8, 4])
    expect(calls.flat().map((request) => request.input.questionText)).toEqual(
      Array.from({ length: 20 }, (_, index) => `Question ${19 - index}`),
    )
    expect(labels.size).toBe(20)
  })

  it('orders by last use before update time', async () => {
    const { calls, classify } = classifier()
    const answers = [dated(0, { lastUsedAt: '2026-06-01T00:00:00.000Z' }), dated(1), dated(2)]
    await createAnswerLabels(memory(), classify, async () => {})(answers, 'runtime-1', 'US')

    expect(calls[0]?.map((request) => request.input.questionText)).toEqual(['Question 0', 'Question 2', 'Question 1'])
  })

  it('yields between chunks but not before the first one', async () => {
    const events: string[] = []
    const { classify } = classifier()
    const counting = async (requests: ClassifyRequest[]) => {
      events.push(`classify:${requests.length}`)
      return classify(requests)
    }
    await createAnswerLabels(memory(), counting, async () => {
      events.push('pause')
    })(many(17), 'runtime-1', 'US')

    expect(events).toEqual(['classify:8', 'pause', 'classify:8', 'pause', 'classify:1'])
  })

  it('stops once the newest answer that satisfies the stop rule is known', async () => {
    const { calls, classify } = classifier()
    const answers = many(30)
    const labels = await createAnswerLabels(memory(), classify, async () => {})(
      answers,
      'runtime-1',
      'US',
      (_answer, label) => label === 'label:Question 18',
    )

    expect(calls.map((call) => call.length)).toEqual([8, 8])
    expect(labels.get('answer-18')).toBe('label:Question 18')
    expect(labels.has('answer-13')).toBe(false)
  })

  it('stops without classifying when a cached answer already satisfies the stop rule', async () => {
    const storage = memory()
    const { calls, classify } = classifier()
    const scheduled = createAnswerLabels(storage, classify, async () => {})
    await scheduled(many(3), 'runtime-1', 'US')
    calls.length = 0

    await scheduled([...many(3), dated(-1)], 'runtime-1', 'US', (_answer, label) => label === 'label:Question 2')

    expect(calls).toHaveLength(0)
  })

  it('reaches older uncached answers only after every newer answer is known', async () => {
    const storage = memory()
    const { calls, classify } = classifier()
    const scheduled = createAnswerLabels(storage, classify, async () => {})
    await scheduled([dated(5)], 'runtime-1', 'US')
    calls.length = 0

    await scheduled(many(6), 'runtime-1', 'US', (_answer, label) => label === 'label:Question 1')

    expect(calls.map((call) => call.map((request) => request.input.questionText))).toEqual([
      ['Question 4', 'Question 3', 'Question 2', 'Question 1', 'Question 0'],
    ])
  })

  it('persists the cache after every chunk', async () => {
    const storage = recording()
    const { classify } = classifier()
    await createAnswerLabels(storage, classify, async () => {})(many(20), 'runtime-1', 'US')

    expect(storage.writes).toEqual([8, 16, 20])
  })

  it('keeps completed chunks and sends nothing more when a chunk fails', async () => {
    const storage = recording()
    const { classify } = classifier()
    let call = 0
    const failing = async (requests: ClassifyRequest[]) => {
      call += 1
      if (call === 2) throw new Error('the classifier was closed')
      return classify(requests)
    }

    const error = await createAnswerLabels(storage, failing, async () => {})(many(20), 'runtime-1', 'US').then(
      () => null,
      (failure: Error) => failure.message,
    )

    expect(error).toBe('the classifier was closed')
    expect(call).toBe(2)
    expect(storage.writes).toEqual([8])
  })

  it('labels answers with an unknown kind as null without sending them', async () => {
    const { calls, classify } = classifier()
    const answers = [dated(0), dated(1, { answerKind: 'legacy' }), dated(2)]
    const labels = await createAnswerLabels(memory(), classify, async () => {})(answers, 'runtime-1', 'US')

    expect(calls.flat().map((request) => request.input.questionText)).toEqual(['Question 2', 'Question 0'])
    expect(labels.get('answer-1')).toBeNull()
  })
})

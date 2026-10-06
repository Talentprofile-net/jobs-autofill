import { describe, expect, it } from 'bun:test'

import { ANSWER_LABELS_KEY, createAnswerLabels } from './answerLabels'
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

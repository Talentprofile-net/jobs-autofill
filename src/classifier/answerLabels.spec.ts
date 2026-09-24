import { describe, expect, it } from 'bun:test'

import { ANSWER_LABELS_KEY, createAnswerLabels } from './answerLabels'
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
  it('classifies each stored answer once per revision and runtime', async () => {
    const storage = memory()
    const { calls, classify } = classifier()
    const labels = createAnswerLabels(storage, classify)
    const answer = talentAnswer()

    await labels([answer], 'runtime-1')
    const again = await labels([answer], 'runtime-1')
    await labels([{ ...answer, updatedAt: '2026-09-01T00:00:00.000Z' }], 'runtime-1')

    expect(again.get('answer-1')).toBe('label:Highest degree obtained')
    expect(calls).toHaveLength(2)
    expect(calls[0]?.[0]?.input.jobCountry).toBe('_unknown')
    expect(calls[0]?.[0]?.input.optionLabels).toEqual([])
  })

  it('reclassifies an answer whose classifier input changed without a new revision', async () => {
    const storage = memory()
    const { calls, classify } = classifier()
    const labels = createAnswerLabels(storage, classify)

    await labels([talentAnswer()], 'runtime-1')
    const edited = await labels([talentAnswer({ questionText: 'Highest education level' })], 'runtime-1')
    await labels([talentAnswer({ fieldType: 'TextArea', questionText: 'Highest education level' })], 'runtime-1')

    expect(calls).toHaveLength(3)
    expect(edited.get('answer-1')).toBe('label:Highest education level')
  })

  it('reclassifies everything for another runtime identity', async () => {
    const storage = memory()
    const first = classifier('runtime-1')
    await createAnswerLabels(storage, first.classify)([talentAnswer()], 'runtime-1')
    const second = classifier('runtime-2')
    await createAnswerLabels(storage, second.classify)([talentAnswer()], 'runtime-2')

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
    const labels = await createAnswerLabels(storage, classify)([talentAnswer()], 'runtime-1')

    expect(calls).toHaveLength(1)
    expect(labels.get('answer-1')).toBe('label:Highest degree obtained')
  })

  it('refuses labels from a runtime other than the one that classified the field', async () => {
    const storage = memory()
    const { classify } = classifier('runtime-2')

    const error = await createAnswerLabels(storage, classify)([talentAnswer()], 'runtime-1').then(
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
    )

    expect(calls).toHaveLength(0)
    expect(result.get('answer-1')).toBeNull()
  })
})

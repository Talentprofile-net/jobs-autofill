import { describe, expect, it } from 'bun:test'

import type { Decision } from './contract'
import { createSuggestionService, type SuggestionServiceDependencies } from './suggestionService'
import { talentAnswer } from './testAnswers'

const accepted: Decision = {
  abstentionReason: null,
  calibratedConfidence: 0.97,
  labelEnumId: 'label-education',
  margin: 0.9,
  modelVersion: 'model-1',
  topLabelEnumId: 'label-education',
  triggeredReasons: [],
}

const request = { answerKind: 'text', fieldType: 'TextInput', optionLabels: [], questionText: 'Education' }

const recording = (enabled: boolean, over: Partial<SuggestionServiceDependencies> = {}) => {
  const called: string[] = []
  const dependencies: SuggestionServiceDependencies = {
    answerLabels: async (answers) => {
      called.push('answerLabels')
      return new Map(answers.map((answer) => [answer.id, 'label-education']))
    },
    answers: async () => {
      called.push('answers')
      return [talentAnswer()]
    },
    classify: async () => {
      called.push('classify')
      return { decisions: [accepted], runtimeId: 'runtime-1' }
    },
    enabled: async () => enabled,
    jobCountry: async (tabId) => {
      called.push(`jobCountry:${tabId}`)
      return 'DE'
    },
    labelNames: async () => {
      called.push('labelNames')
      return new Map()
    },
    release: async () => {
      called.push('release')
    },
    ...over,
  }
  return { called, suggest: createSuggestionService(dependencies) }
}

describe('suggestion service', () => {
  it('does nothing but read the switch while it is off', async () => {
    const { called, suggest } = recording(false)

    expect(await suggest(request, 7)).toEqual({ status: 'disabled' })
    expect(called).toEqual([])
  })

  it('rejects a malformed request before reading answers or starting the classifier', async () => {
    const { called, suggest } = recording(true)

    expect(await suggest({ ...request, answerKind: 'legacy' }, 7)).toEqual({
      error: 'invalid suggestion request',
      status: 'unavailable',
    })
    expect(called).toEqual([])
  })

  it('classifies with the job country bound to the tab and links the saved answer', async () => {
    const { called, suggest } = recording(true)
    const result = await suggest(request, 7)

    expect(result.status === 'classified' ? [result.jobCountry, result.answer?.id] : result).toEqual([
      'DE',
      'answer-1',
    ])
    expect(called).toContain('jobCountry:7')
    expect(called).toContain('classify')
    expect(called).toContain('answerLabels')
  })

  it('never loads label names or starts the classifier for an exact question match', async () => {
    const { called, suggest } = recording(true, {
      answers: async () => [talentAnswer({ normalizedQuestion: 'education' })],
    })
    const result = await suggest(request, 7)

    expect(result.status).toBe('matched')
    expect(called.filter((name) => ['labelNames', 'classify', 'answerLabels'].includes(name))).toEqual([])
  })

  it('answers disabled and releases the model when the switch turns off mid-request', async () => {
    let checks = 0
    const { called, suggest } = recording(true, {
      enabled: async () => {
        checks += 1
        return checks === 1
      },
    })

    expect(await suggest(request, 7)).toEqual({ status: 'disabled' })
    expect(called).toContain('classify')
    expect(called.at(-1)).toBe('release')
  })

  it('keeps the model while the switch stays on', async () => {
    const { called, suggest } = recording(true)
    await suggest(request, 7)

    expect(called).not.toContain('release')
  })

  it('turns a failed model load into unavailable, so the next request tries again', async () => {
    let loads = 0
    const { suggest } = recording(true, {
      classify: async () => {
        loads += 1
        if (loads === 1) throw new Error('cannot read model.onnx: 404')
        return { decisions: [accepted], runtimeId: 'runtime-1' }
      },
    })

    expect(await suggest(request, 7)).toEqual({ error: 'cannot read model.onnx: 404', status: 'unavailable' })
    expect((await suggest(request, 7)).status).toBe('classified')
  })
})

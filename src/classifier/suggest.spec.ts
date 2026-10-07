import { describe, expect, it } from 'bun:test'

import { createAnswerLabels } from './answerLabels'
import type { Decision } from './contract'
import {
  SUGGESTION_REQUEST_LIMITS,
  readSuggestionRequest,
  suggestAnswer,
  type ClassifyRequest,
  type SuggestionDependencies,
} from './suggest'
import { talentAnswer } from './testAnswers'
import type { ProfileValue } from '~/field/types'

const decision = (over: Partial<Decision> = {}): Decision => ({
  abstentionReason: null,
  calibratedConfidence: 0.97,
  labelEnumId: 'label-education',
  margin: 0.9,
  modelVersion: 'model-1',
  topLabelEnumId: 'label-education',
  triggeredReasons: [],
  ...over,
})

const dependencies = (
  fieldDecision: Decision,
  answerLabels: Record<string, string | null> = {},
): SuggestionDependencies & {
  calls: ClassifyRequest[][]
  countries: string[]
  linked: string[][]
  runtimes: string[]
} => {
  const calls: ClassifyRequest[][] = []
  const countries: string[] = []
  const linked: string[][] = []
  const runtimes: string[] = []
  return {
    answerLabels: async (answers, runtimeId, jobCountry) => {
      runtimes.push(runtimeId)
      countries.push(jobCountry)
      linked.push(answers.map((a) => a.id))
      return new Map(answers.map((a) => [a.id, answerLabels[a.id] ?? null]))
    },
    calls,
    countries,
    linked,
    classify: async (requests) => {
      calls.push(requests)
      return { decisions: [fieldDecision], runtimeId: 'runtime-1' }
    },
    labelName: async (id) => `name:${id}`,
    runtimes,
    standardValue: async () => null,
  }
}

const chosenId = async (answers: ReturnType<typeof talentAnswer>[], labels: Record<string, string>) => {
  const result = await suggestAnswer(request, answers, '_unknown', dependencies(decision(), labels))
  return result.status === 'classified' ? result.answer?.id : `status ${result.status}`
}

const request = {
  answerKind: 'text' as const,
  fieldType: 'TextInput',
  optionLabels: [],
  questionText: 'What is your education level?',
}

describe('classifier suggestions', () => {
  it('prefers an exact question match and never calls the classifier', async () => {
    const deps = dependencies(decision())
    const answer = talentAnswer({ normalizedQuestion: 'what-is-your-education-level' })
    const result = await suggestAnswer(request, [answer], 'DE', deps)

    expect(result.status).toBe('matched')
    expect(deps.calls).toHaveLength(0)
    expect(deps.runtimes).toHaveLength(0)
  })

  it('prefers a word-overlap match and never calls the classifier', async () => {
    const deps = dependencies(decision())
    const answer = talentAnswer({
      normalizedQuestion: 'expected-annual-salary-in-euros',
      questionText: 'Expected annual salary in euros',
    })
    const result = await suggestAnswer(
      { ...request, questionText: 'Expected annual salary (euros)' },
      [answer],
      'DE',
      deps,
    )

    expect(result.status === 'matched' ? result.method : result.status).toBe('jaccard')
    expect(deps.calls).toHaveLength(0)
    expect(deps.runtimes).toHaveLength(0)
  })

  it('passes the current form country to the stored-answer labels', async () => {
    const deps = dependencies(decision(), { 'answer-1': 'label-education' })
    await suggestAnswer(request, [talentAnswer({ jobCountry: 'DE' })], 'US', deps)

    expect(deps.countries).toEqual(['US'])
  })

  it('links a reusable answer captured in DE on a US form, classifying both sides with US', async () => {
    const calls: ClassifyRequest[][] = []
    const classify = async (requests: ClassifyRequest[]) => {
      calls.push(requests)
      return { decisions: requests.map(() => decision()), runtimeId: 'runtime-1' }
    }
    const storage: Record<string, unknown> = {}
    const result = await suggestAnswer(request, [talentAnswer({ jobCountry: 'DE' })], 'US', {
      answerLabels: createAnswerLabels(
        {
          get: async (key) => ({ [key]: storage[key] }),
          set: async (items) => {
            Object.assign(storage, items)
          },
        },
        classify,
      ),
      classify,
      labelName: async (id) => `name:${id}`,
      standardValue: async () => null,
    })

    expect(calls.map((call) => call.map((item) => [item.input.questionText, item.input.jobCountry]))).toEqual([
      [['What is your education level?', 'US']],
      [['Highest degree obtained', 'US']],
    ])
    expect(result.status === 'classified' ? [result.jobCountry, result.answer?.id] : result).toEqual([
      'US',
      'answer-1',
    ])
  })

  describe('a country-sensitive question', () => {
    const authorized = { ...request, questionText: 'Are you legally authorized to work in this country?' }
    const stored = (id: string, jobCountry: string) =>
      talentAnswer({
        answerText: 'Yes',
        answerValue: { confidence: 'exact', kind: 'string', value: 'Yes' },
        id,
        jobCountry,
        normalizedQuestion: 'do-you-have-the-right-to-work-here',
        questionText: 'Do you have the right to work here?',
      })

    it('never offers an answer captured for DE on a US form', async () => {
      const deps = dependencies(decision(), { de: 'label-education' })
      const result = await suggestAnswer(authorized, [stored('de', 'DE')], 'US', deps)

      expect(deps.linked).toEqual([[]])
      expect(result.status === 'classified' ? result.answer : result).toBeNull()
    })

    it('offers an answer captured for US on a US form', async () => {
      const deps = dependencies(decision(), { de: 'label-education', us: 'label-education' })
      const result = await suggestAnswer(authorized, [stored('de', 'DE'), stored('us', 'US')], 'US', deps)

      expect(deps.linked).toEqual([['us']])
      expect(deps.countries).toEqual(['US'])
      expect(result.status === 'classified' ? result.answer?.id : result).toBe('us')
    })
  })

  it('classifies after slug and word overlap fail and passes the job country through', async () => {
    const deps = dependencies(decision(), { 'answer-1': 'label-education' })
    const result = await suggestAnswer(request, [talentAnswer()], 'DE', deps)

    expect(deps.calls[0]?.[0]?.input.jobCountry).toBe('DE')
    expect(deps.calls[0]?.[0]?.input.fieldType).toBe('TextInput')
    expect(result.status).toBe('classified')
    if (result.status !== 'classified') return
    expect(result.answer?.id).toBe('answer-1')
    expect(result.label).toBe('name:label-education')
    expect(result.value).toEqual({ confidence: 'guess', kind: 'string', value: 'Master of Science' })
  })

  it('chooses the most recently used stored answer with the same accepted label', async () => {
    const older = talentAnswer({ id: 'older', updatedAt: '2026-01-01T00:00:00.000Z' })
    const newer = talentAnswer({ id: 'newer', lastUsedAt: '2026-09-01T00:00:00.000Z' })
    const other = talentAnswer({ id: 'other', lastUsedAt: '2026-09-20T00:00:00.000Z' })
    const deps = dependencies(decision(), {
      newer: 'label-education',
      older: 'label-education',
      other: 'label-degree',
    })
    const result = await suggestAnswer(request, [older, newer, other], '_unknown', deps)

    expect(result.status === 'classified' ? result.answer?.id : null).toBe('newer')
  })

  it('breaks an equal-recency tie the same way whatever order the answers arrive in', async () => {
    const same = { lastUsedAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' }
    const b = talentAnswer({ ...same, answerText: 'B', id: 'answer-b' })
    const a = talentAnswer({ ...same, answerText: 'A', id: 'answer-a' })
    const labels = { 'answer-a': 'label-education', 'answer-b': 'label-education' }

    expect(await chosenId([b, a], labels)).toBe('answer-a')
    expect(await chosenId([a, b], labels)).toBe('answer-a')
  })

  it('prefers the later update when the last use is the same moment', async () => {
    const lastUsedAt = '2026-09-01T00:00:00.000Z'
    const earlier = talentAnswer({ id: 'answer-a', lastUsedAt, updatedAt: '2026-07-01T00:00:00.000Z' })
    const later = talentAnswer({ id: 'answer-b', lastUsedAt, updatedAt: '2026-08-01T00:00:00.000Z' })
    const labels = { 'answer-a': 'label-education', 'answer-b': 'label-education' }

    expect(await chosenId([earlier, later], labels)).toBe('answer-b')
  })

  it('compares timestamps as instants, not as text', async () => {
    const utc = talentAnswer({ id: 'answer-a', lastUsedAt: '2026-09-01T10:00:00.000Z' })
    const offset = talentAnswer({ id: 'answer-b', lastUsedAt: '2026-09-01T09:00:00.000-02:00' })
    const labels = { 'answer-a': 'label-education', 'answer-b': 'label-education' }

    expect(await chosenId([utc, offset], labels)).toBe('answer-b')
  })

  it('skips a newer linked answer that holds nothing usable and takes the next one', async () => {
    const broken = talentAnswer({
      answerText: null,
      answerValue: { kind: 'string', value: '   ' },
      id: 'broken',
      lastUsedAt: '2026-09-20T00:00:00.000Z',
    })
    const usable = talentAnswer({ id: 'usable', lastUsedAt: '2026-09-01T00:00:00.000Z' })
    const labels = { broken: 'label-education', usable: 'label-education' }

    expect(await chosenId([broken, usable], labels)).toBe('usable')
  })

  it('links stored answers under the runtime identity that classified the field', async () => {
    const deps = dependencies(decision(), { 'answer-1': 'label-education' })
    await suggestAnswer(request, [talentAnswer()], '_unknown', deps)

    expect(deps.runtimes).toEqual(['runtime-1'])
  })

  it('ignores stored answers of an incompatible field type', async () => {
    const answer = talentAnswer({ fieldType: 'Checkbox' })
    const deps = dependencies(decision(), { 'answer-1': 'label-education' })
    const result = await suggestAnswer(request, [answer], '_unknown', deps)

    expect(result.status === 'classified' ? result.answer : 'wrong').toBeNull()
  })

  it('reports the abstention reason and offers nothing to fill', async () => {
    const deps = dependencies(
      decision({ abstentionReason: 'low_confidence', calibratedConfidence: 0.4, labelEnumId: null }),
    )
    const result = await suggestAnswer(request, [talentAnswer()], '_unknown', deps)

    expect(deps.runtimes).toHaveLength(0)

    expect(result).toEqual({
      confidence: 0.4,
      jobCountry: '_unknown',
      modelVersion: 'model-1',
      reason: 'low_confidence',
      status: 'abstained',
      topLabel: 'name:label-education',
      topLabelEnumId: 'label-education',
    })
  })
})

describe('standard field suggestions', () => {
  const email: ProfileValue = { confidence: 'exact', kind: 'string', value: 'audit.tester@example.invalid' }
  const standardRequest = { ...request, questionText: 'E-Mail', standardField: 'email' as const }
  const withStandard = (value: ProfileValue | null) => {
    const deps = dependencies(decision(), { 'answer-1': 'label-education' })
    const asked: string[] = []
    return {
      asked,
      deps: {
        ...deps,
        standardValue: async (field: string, fieldType: string) => {
          asked.push(`${field}:${fieldType}`)
          return value
        },
      },
    }
  }

  it('suggests the profile value for a standard field before the classifier', async () => {
    const { asked, deps } = withStandard(email)
    const result = await suggestAnswer(standardRequest, [talentAnswer()], 'DE', deps)

    expect(result).toEqual({ method: 'dom_standard', standardField: 'email', status: 'standard', value: email })
    expect(asked).toEqual(['email:TextInput'])
    expect(deps.calls).toHaveLength(0)
    expect(deps.runtimes).toHaveLength(0)
  })

  it('lets an exact question match win over the standard field', async () => {
    const { asked, deps } = withStandard(email)
    const answer = talentAnswer({ normalizedQuestion: 'e-mail', questionText: 'E-Mail' })
    const result = await suggestAnswer(standardRequest, [answer], 'DE', deps)

    expect(result.status === 'matched' ? result.method : result.status).toBe('normalized_text')
    expect(asked).toEqual([])
  })

  it('lets a word-overlap match win over the standard field', async () => {
    const { asked, deps } = withStandard(email)
    const answer = talentAnswer({
      normalizedQuestion: 'personal-contact-email-address-for-recruiters',
      questionText: 'Personal contact email address for recruiters',
    })
    const result = await suggestAnswer(
      { ...standardRequest, questionText: 'Personal contact email address (recruiters)' },
      [answer],
      'DE',
      deps,
    )

    expect(result.status === 'matched' ? result.method : result.status).toBe('jaccard')
    expect(asked).toEqual([])
  })

  it('falls back to the classifier when the profile has no usable value', async () => {
    for (const value of [null, { confidence: 'exact', kind: 'string', value: '  ' } as const]) {
      const { asked, deps } = withStandard(value)
      const result = await suggestAnswer(standardRequest, [talentAnswer()], 'DE', deps)

      expect(asked).toEqual(['email:TextInput'])
      expect(deps.calls).toHaveLength(1)
      expect(result.status).toBe('classified')
    }
  })

  it('falls back to the classifier when the page sent no standard field', async () => {
    const { asked, deps } = withStandard(email)
    const result = await suggestAnswer(request, [talentAnswer()], 'DE', deps)

    expect(asked).toEqual([])
    expect(deps.calls).toHaveLength(1)
    expect(result.status).toBe('classified')
  })

  it('never uses a standard field on a sensitive or third-party question', async () => {
    for (const questionText of ['Referrer email', 'Expected salary', 'Do you require visa sponsorship?', 'Gender']) {
      const { asked, deps } = withStandard(email)
      const result = await suggestAnswer({ ...standardRequest, questionText }, [talentAnswer()], 'DE', deps)

      expect(asked).toEqual([])
      expect(result.status === 'standard').toBe(false)
    }
  })
})

describe('suggestion request from the page', () => {
  const valid = { answerKind: 'choice', fieldType: 'SimpleDropdown', optionLabels: ['Yes', 'No'], questionText: 'Q' }

  it('keeps a listed standard field', () => {
    expect(readSuggestionRequest({ ...valid, standardField: 'country' })).toEqual({ ...valid, standardField: 'country' })
    expect(readSuggestionRequest({ ...valid, standardField: null })).toEqual(valid)
  })

  it('keeps a well-formed request and drops every other key', () => {
    expect(readSuggestionRequest({ ...valid, __proto__: { polluted: true }, extra: 'x' })).toEqual(valid)
  })

  it.each<[string, unknown]>([
    ['a non-object', 'text'],
    ['null', null],
    ['an array', [valid]],
    ['an unknown answer kind', { ...valid, answerKind: 'legacy' }],
    ['a missing field type', { ...valid, fieldType: '' }],
    ['a field type that is not text', { ...valid, fieldType: 7 }],
    ['an oversized field type', { ...valid, fieldType: 'x'.repeat(SUGGESTION_REQUEST_LIMITS.fieldType + 1) }],
    ['a question that is not text', { ...valid, questionText: { toString: (): string => 'Q' } }],
    ['an oversized question', { ...valid, questionText: 'x'.repeat(SUGGESTION_REQUEST_LIMITS.questionText + 1) }],
    ['options that are not a list', { ...valid, optionLabels: 'Yes / No' }],
    ['an option that is not text', { ...valid, optionLabels: ['Yes', 1] }],
    ['an oversized option', { ...valid, optionLabels: ['x'.repeat(SUGGESTION_REQUEST_LIMITS.optionLabel + 1)] }],
    ['an unlisted standard field', { ...valid, standardField: 'url' }],
    ['a standard field that is not text', { ...valid, standardField: 1 }],
    ['too many options', { ...valid, optionLabels: Array.from({ length: SUGGESTION_REQUEST_LIMITS.optionLabels + 1 }, () => 'o') }],
  ])('rejects %s', (_, raw) => {
    expect(readSuggestionRequest(raw)).toBeNull()
  })

  it('accepts an empty question, which the policy abstains on as unknown_question', () => {
    expect(readSuggestionRequest({ ...valid, questionText: '' })).toEqual({ ...valid, questionText: '' })
  })

  it('uses the limits the page is held to', () => {
    expect(SUGGESTION_REQUEST_LIMITS).toEqual({
      fieldType: 64,
      optionLabel: 4_096,
      optionLabels: 60,
      optionText: 65_536,
      questionText: 4_096,
    })
  })

  const text = (length: number): string => 'x'.repeat(length)
  const options = (count: number, length = 1): string[] => Array.from({ length: count }, () => text(length))
  const { fieldType, optionLabel, optionLabels, optionText, questionText } = SUGGESTION_REQUEST_LIMITS

  it.each<[string, Record<string, unknown>]>([
    ['field type', { fieldType: text(fieldType) }],
    ['question', { questionText: text(questionText) }],
    ['option count', { optionLabels: options(optionLabels) }],
    ['option length', { optionLabels: [text(optionLabel)] }],
    ['total option text', { optionLabels: options(optionText / optionLabel, optionLabel) }],
    ['total option text split unevenly', { optionLabels: [...options(15, optionLabel), text(optionLabel - 1), 'x'] }],
  ])('accepts the %s exactly at its limit', (_, over) => {
    expect(readSuggestionRequest({ ...valid, ...over })).toEqual({ ...valid, ...over })
  })

  it.each<[string, Record<string, unknown>]>([
    ['field type', { fieldType: text(fieldType + 1) }],
    ['question', { questionText: text(questionText + 1) }],
    ['option count', { optionLabels: options(optionLabels + 1) }],
    ['option length', { optionLabels: [text(optionLabel + 1)] }],
    ['total option text', { optionLabels: [...options(optionText / optionLabel, optionLabel), 'x'] }],
    ['total option text split unevenly', { optionLabels: [...options(15, optionLabel), text(optionLabel - 1), 'xx'] }],
  ])('rejects the %s one over its limit', (_, over) => {
    expect(readSuggestionRequest({ ...valid, ...over })).toBeNull()
  })
})

describe('bounded stored-answer scheduling in a suggestion', () => {
  const run = async (answers: ReturnType<typeof talentAnswer>[], labelOf: (questionText: string) => string | null) => {
    const calls: ClassifyRequest[][] = []
    const classify = async (requests: ClassifyRequest[]) => {
      calls.push(requests)
      return {
        decisions: requests.map((item) =>
          item.input.questionText === request.questionText
            ? decision()
            : decision({ labelEnumId: labelOf(item.input.questionText), topLabelEnumId: 'label-any' }),
        ),
        runtimeId: 'runtime-1',
      }
    }
    const storage: Record<string, unknown> = {}
    const result = await suggestAnswer(request, answers, 'US', {
      answerLabels: createAnswerLabels(
        {
          get: async (key) => ({ [key]: storage[key] }),
          set: async (items) => {
            Object.assign(storage, items)
          },
        },
        classify,
        async () => {},
      ),
      classify,
      labelName: async (id) => `name:${id}`,
      standardValue: async () => null,
    })
    return { calls, chosen: result.status === 'classified' ? (result.answer?.id ?? null) : `status ${result.status}` }
  }

  const fullScan = (answers: ReturnType<typeof talentAnswer>[], labelOf: (questionText: string) => string | null) =>
    [...answers]
      .filter((answer) => answer.fieldType === 'TextInput' && labelOf(answer.questionText) === 'label-education')
      .sort(
        (a, b) =>
          Date.parse(b.lastUsedAt ?? b.updatedAt) - Date.parse(a.lastUsedAt ?? a.updatedAt) ||
          Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )
      .find((answer) => (answer.answerText ?? '').trim().length > 0)?.id ?? null

  const seeded = (seed: number) => {
    let state = seed
    return () => {
      state = (state * 1103515245 + 12345) % 2147483648
      return state / 2147483648
    }
  }

  it.each(Array.from({ length: 25 }, (_, index) => index + 1))(
    'chooses the same answer as a full scan of every stored answer (seed %i)',
    async (seed) => {
      const random = seeded(seed)
      const answers = Array.from({ length: 40 }, (_, index) => {
        const usable = random() > 0.3
        const text = usable ? `Answer ${index}` : ''
        return talentAnswer({
          answerText: text,
          answerValue: { confidence: 'exact', kind: 'string', value: text },
          fieldType: random() > 0.15 ? 'TextInput' : 'FileUpload',
          id: `answer-${index}`,
          lastUsedAt: random() > 0.7 ? new Date(Date.UTC(2026, 5, 1, 0, Math.floor(random() * 500))).toISOString() : null,
          questionText: `Stored question ${index}`,
          updatedAt: new Date(Date.UTC(2026, 0, 1, 0, Math.floor(random() * 500))).toISOString(),
        })
      })
      const matching = new Set(answers.filter(() => random() > 0.8).map((answer) => answer.questionText))
      const labelOf = (questionText: string) => (matching.has(questionText) ? 'label-education' : 'label-other')

      const { calls, chosen } = await run(answers, labelOf)

      expect(chosen).toBe(fullScan(answers, labelOf))
      expect(calls.slice(1).every((call) => call.length <= 8)).toBe(true)
      expect(calls.flat().every((item) => item.input.fieldType !== 'FileUpload')).toBe(true)
    },
  )

  it('classifies only the chunks needed to reach the newest usable answer with the accepted label', async () => {
    const answers = Array.from({ length: 128 }, (_, index) =>
      talentAnswer({
        answerText: `Answer ${index}`,
        answerValue: { confidence: 'exact', kind: 'string', value: `Answer ${index}` },
        id: `answer-${index}`,
        questionText: `Stored question ${index}`,
        updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      }),
    )
    const { calls, chosen } = await run(answers, (questionText) =>
      questionText === 'Stored question 117' || questionText === 'Stored question 3' ? 'label-education' : null,
    )

    expect(chosen).toBe('answer-117')
    expect(calls.map((call) => call.length)).toEqual([1, 8, 8])
  })
})

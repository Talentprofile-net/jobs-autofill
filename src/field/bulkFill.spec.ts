import { afterEach, describe, expect, it, mock } from 'bun:test'

import type { Profile } from '~/api/types'
import type { ContentScriptRequest, FieldResolveRequest, FillValueResult, ResolvedOriginMode } from '~/bridge/types'
import { talentAnswer } from '~/classifier/testAnswers'
import { installDom, setRect, shimXPath } from '~/core/__fixtures__/domGlobals'
import { querySelectorAllDeep } from '~/core/shadowDom'
import { fieldsWithoutProfileValue, mergeFillValues } from '~/bridge/fillValues'
import { resolveLearnedAnswersBatch } from '~/resolver/learnedAnswers'
import { normalizeQuestion } from '~/resolver/normalizeQuestion'
import { resolveField } from '~/resolver/profileResolver'
import * as mainBridge from '~/bridge/mainBridge'

const actualBridge = { ...mainBridge }
const results: FillValueResult[] = []

const ALTERNATE = ['Preferred First Name', 'Preferred First & Last Name', 'Legal Name (if different than above)']

const savedAnswer = (questionText: string, i: number, value = 'Saved Alternate') =>
  talentAnswer({
    answerText: value,
    answerValue: { confidence: 'exact', kind: 'string', value },
    id: `saved-${i}`,
    normalizedQuestion: normalizeQuestion(questionText),
    questionText,
  })

const PRONUNCIATION_VALUE = 'AW-dit TES-ter'

const PRONOUNS_VALUE = 'they/them'

const EXACT = [
  ['Name pronunciation', PRONUNCIATION_VALUE],
  ['Phonetic spelling of your full name', PRONUNCIATION_VALUE],
  ['Preferred pronouns', PRONOUNS_VALUE],
] as const

const PROFILE: Profile = {
  description: null,
  education: null,
  experience: null,
  hourlyRate: null,
  id: 'audit-profile',
  isAvailableForHire: null,
  isInterestedInRelocation: null,
  jobTitle: null,
  languages: null,
  links: null,
  location: 'Berlin, Germany',
  monthlyRate: null,
  profileName: 'Audit Tester',
  rateCurrency: null,
  skills: null,
  talentAnswers: [
    ...ALTERNATE.map((question, i) => savedAnswer(question, i)),
    ...EXACT.map(([question, value], i) => savedAnswer(question, ALTERNATE.length + i, value)),
  ],
  talentNotes: null,
  totalExperience: null,
  user: { email: 'audit.tester@example.invalid', phoneNumber: null },
}

mock.module('~/ui/picker/iconMount', () => ({ mountPickerIcon: () => null }))
mock.module('~/ui/formWidgetMount', () => ({ mountFormFillButton: () => ({ destroy: () => {} }) }))
mock.module('~/bridge/mainBridge', () => ({
  ...actualBridge,
  requestFillValues: async (_batchId: string, fields: (FieldResolveRequest & { requestId: string })[]) => {
    const fromProfile = fields.map((field) => ({
      requestId: field.requestId,
      ...resolveField(field.fieldName, field.fieldType, field.section, PROFILE),
    }))
    const learned = resolveLearnedAnswersBatch(fieldsWithoutProfileValue(fields, fromProfile), PROFILE, '_unknown')
    const merged = mergeFillValues(fields, fromProfile, learned)
    results.push(...merged)
    return new Map(merged.map((result) => [result.requestId, result]))
  },
}))

const { allFields, fillFormContainer, startObserver } = await import('./registry')

const LABELS = [
  ['first', 'First Name'],
  ['last', 'Last Name'],
  ['legal-first', 'Legal First Name'],
  ['legal-last', 'Legal Last Name'],
  ['preferred-first', 'Preferred First Name'],
  ['preferred-full', 'Preferred First &amp; Last Name'],
  ['legal-different', 'Legal Name (if different than above)'],
  ['preferred-location', 'Preferred location'],
  ['full', 'Full Name'],
  ['legal', 'Legal Name'],
  ['pronounce', 'How do you pronounce your name?'],
  ['say', 'How should we say your name?'],
  ['phonetic', 'Phonetic spelling of your name'],
  ['pronunciation', 'Name pronunciation'],
  ['pronouns', 'Preferred pronouns'],
]

const FORM = `<html><body><form id="application">
${LABELS.map(([id, label]) => `  <div class="entry"><label for="${id}">${label}</label><input id="${id}" type="text"></div>`).join('\n')}
</form></body></html>`

const mountPage = () => {
  const dom = installDom(FORM)
  Object.assign(globalThis, { HTMLTextAreaElement: dom.HTMLTextAreaElement, InputEvent: dom.InputEvent })
  Object.assign(dom.window, {
    clearTimeout,
    getComputedStyle: () => ({ direction: 'ltr', display: 'block', opacity: '1', visibility: 'visible' }),
    scrollX: 0,
    scrollY: 0,
    setTimeout,
  })
  Object.defineProperty(dom.window, 'location', { configurable: true, value: { hostname: 'apply.example.invalid', origin: 'https://apply.example.invalid' } })
  shimXPath()
  for (const el of querySelectorAllDeep(document, '*')) setRect(el, { height: 30, width: 300, x: 100, y: 100 })
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

const value = (id: string) => (document.getElementById(id) as HTMLInputElement).value

describe('bulk fill through the real resolvers', () => {
  let stop: (() => void) | null = null

  afterEach(() => {
    stop?.()
    stop = null
    results.length = 0
  })

  it('fills legal names, the preferred location and exact saved answers and leaves alternate names and unanswered pronunciation untouched', async () => {
    mountPage()
    const handlers: Array<(msg: ContentScriptRequest) => void> = []
    stop = startObserver({
      getOriginMode: () => Promise.resolve<ResolvedOriginMode>('application'),
      onBridgeMessage: (handler) => {
        handlers.push(handler)
        return () => handlers.splice(handlers.indexOf(handler), 1)
      },
    })
    await tick()
    expect(allFields()).toHaveLength(LABELS.length)

    for (const handler of [...handlers]) handler({ batchId: 'bulk-1', emit: false, id: 'run-1', kind: 'fill.run', lowScore: false, requestId: null })
    for (let waited = 0; waited < 5_000 && results.length < LABELS.length; waited += 50) await tick(50)
    const snapshot = () => JSON.stringify(LABELS.map(([id]) => value(id)))
    for (let waited = 0, last = snapshot(), still = 0; waited < 20_000 && still < 1_500; waited += 100) {
      await tick(100)
      const next = snapshot()
      still = next === last ? still + 100 : 0
      last = next
    }

    expect(LABELS.map(([id]) => [id, value(id)])).toEqual([
      ['first', 'Audit'],
      ['last', 'Tester'],
      ['legal-first', 'Audit'],
      ['legal-last', 'Tester'],
      ['preferred-first', ''],
      ['preferred-full', ''],
      ['legal-different', ''],
      ['preferred-location', 'Berlin, Germany'],
      ['full', 'Audit Tester'],
      ['legal', 'Audit Tester'],
      ['pronounce', ''],
      ['say', ''],
      ['phonetic', ''],
      ['pronunciation', PRONUNCIATION_VALUE],
      ['pronouns', PRONOUNS_VALUE],
    ])
    const byName = new Map(allFields().map((field) => [field.uuid, field.fieldName]))
    const alternate = results.filter((result) => ALTERNATE.includes(byName.get(result.requestId) ?? ''))
    expect(alternate).toHaveLength(ALTERNATE.length)
    for (const result of alternate) {
      expect(result).toEqual({ matchedAnswerId: null, profileField: null, requestId: result.requestId, value: { kind: 'unsupported' } })
    }
    const location = results.find((result) => byName.get(result.requestId) === 'Preferred location')
    expect(location?.profileField).toBe('location')
    const resultFor = (fieldName: string) => results.find((result) => byName.get(result.requestId) === fieldName)
    for (const fieldName of ['How do you pronounce your name?', 'How should we say your name?', 'Phonetic spelling of your name']) {
      const result = resultFor(fieldName)
      expect(result && [result.matchedAnswerId, result.profileField, result.value]).toEqual([null, null, { kind: 'unsupported' }])
    }
    expect(resultFor('Name pronunciation')?.matchedAnswerId).toBe(`saved-${ALTERNATE.length}`)
    expect(resultFor('Preferred pronouns')?.matchedAnswerId).toBe(`saved-${ALTERNATE.length + 2}`)
  })

  it('leaves fields under a third-party legend empty in bulk fill and still fills the applicant field outside it', async () => {
    const rows = [
      {
        form: '<form id="application"><fieldset><legend>Emergency contact</legend><div class="entry"><label for="ec-name">Name</label><input id="ec-name" type="text"></div><div class="entry"><label for="ec-email">Email</label><input id="ec-email" type="text"></div></fieldset><div class="entry"><label for="own-email">Email</label><input id="own-email" type="text"></div></form>',
        thirdParty: ['ec-name', 'ec-email'],
      },
      {
        form: '<form id="application"><fieldset><legend>Emergency contact</legend><div class="entry"><label for="em-email">Email</label><input id="em-email" type="text"></div><div class="entry"><label for="em-name">Full Name</label><input id="em-name" type="text"></div></fieldset><div class="entry"><label for="own-email">Email</label><input id="own-email" type="text"></div></form>',
        thirdParty: ['em-email', 'em-name'],
      },
    ]
    for (const [index, { form, thirdParty }] of rows.entries()) {
      mountPage()
      document.body.innerHTML = form
      for (const el of querySelectorAllDeep(document, '*')) setRect(el, { height: 30, width: 300, x: 100, y: 100 })
      const handlers: Array<(msg: ContentScriptRequest) => void> = []
      stop = startObserver({
        getOriginMode: () => Promise.resolve<ResolvedOriginMode>('application'),
        onBridgeMessage: (handler) => {
          handlers.push(handler)
          return () => handlers.splice(handlers.indexOf(handler), 1)
        },
      })
      await tick()

      for (const handler of [...handlers]) handler({ batchId: `bulk-ec-${index}`, emit: false, id: `run-ec-${index}`, kind: 'fill.run', lowScore: false, requestId: null })
      for (let waited = 0; waited < 5_000 && value('own-email') === ''; waited += 50) await tick(50)
      const ids = [...thirdParty, 'own-email']
      const snapshot = () => JSON.stringify(ids.map((id) => value(id)))
      for (let waited = 0, last = snapshot(), still = 0; waited < 20_000 && still < 1_500; waited += 100) {
        await tick(100)
        const next = snapshot()
        still = next === last ? still + 100 : 0
        last = next
      }

      expect(ids.map((id) => [id, value(id)])).toEqual([...thirdParty.map((id) => [id, '']), ['own-email', 'audit.tester@example.invalid']])
      stop?.()
      stop = null
      results.length = 0
    }
  }, 30_000)

  it('fills a question revealed by an earlier fill in the next pass of the same run', async () => {
    mountPage()
    stop = startObserver({
      getOriginMode: () => Promise.resolve<ResolvedOriginMode>('application'),
      onBridgeMessage: () => () => {},
    })
    await tick()
    document.getElementById('last')!.addEventListener(
      'change',
      () => {
        const row = document.createElement('div')
        row.className = 'entry'
        row.innerHTML = '<label for="late-email">Email</label><input id="late-email" type="email">'
        document.getElementById('application')!.append(row)
        for (const el of [row, ...Array.from(row.querySelectorAll('*'))]) setRect(el, { height: 30, width: 300, x: 100, y: 100 })
      },
      { once: true },
    )

    const counts = await fillFormContainer('bulk-late', document.getElementById('application')!)

    expect(value('late-email')).toBe('audit.tester@example.invalid')
    expect(counts.filled).toBe(10)
  })

  it('reports nine filled and six unsupported fields from one bulk fill of the name form', async () => {
    mountPage()
    stop = startObserver({
      getOriginMode: () => Promise.resolve<ResolvedOriginMode>('application'),
      onBridgeMessage: () => () => {},
    })
    await tick()

    const counts = await fillFormContainer('bulk-counts', document.getElementById('application')!)

    expect(counts).toEqual({ failed: 0, filled: 9, skipped: 0, unsupported: 6 })
  })
})

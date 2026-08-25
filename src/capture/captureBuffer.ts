import { detectAts } from '~/core/ats'
import { detectSubmitOutcome } from './submitDetection'
import {
  commitCaptureViaBridge,
  discardCaptureViaBridge,
  stageCaptureViaBridge,
} from '~/bridge/mainBridge'
import { normalizeQuestion } from '~/resolver/normalizeQuestion'
import {
  coerceToProfileValueShape,
  profileValueToText,
} from '~/resolver/captureCoercion'
import { toCorpusAnswerKind, toCorpusFieldType } from './corpusVocabulary'
import { readOptionLabels } from './optionLabels'
import type { BaseField } from '~/field/baseField'
import type { AnswerCaptureRecord } from '~/bridge/types'

type FormCaptureState = {
  buttonHandler: ((event: Event) => void) | null
  form: HTMLElement
  fields: Set<BaseField>
  listenerAttached: boolean
  pendingDetection: boolean
  stageId: string | null
  submitHandler: ((event: Event) => void) | null
}

const formStates = new WeakMap<HTMLElement, FormCaptureState>()
const trackedForms = new Set<HTMLElement>()
const fieldForms = new WeakMap<BaseField, HTMLElement>()

const findEnclosingForm = (el: HTMLElement): HTMLElement | null => {
  const direct = el.closest('form')
  if (direct) return direct as HTMLElement
  let node: HTMLElement | null = el.parentElement
  let depth = 0
  while (node && depth < 12) {
    const role = node.getAttribute('role')
    if (role === 'form' || role === 'main') return node
    node = node.parentElement
    depth++
  }
  return null
}

const buildRecord = (field: BaseField): AnswerCaptureRecord | null => {
  const capture = field.collectCapture(null)
  if (!capture) return null
  const value = coerceToProfileValueShape(capture.currentValue, capture.fieldType)
  if (!value) return null

  const questionText = capture.fieldName.trim()
  if (!questionText) return null

  const normalizedQuestion = normalizeQuestion(questionText)
  if (!normalizedQuestion) return null

  const corpusFieldType = toCorpusFieldType(capture.fieldType)
  // Read from the live DOM, before submit navigates away from it. The corpus
  // decides `answerKind` from the option set, not from the value picked.
  const optionLabels = readOptionLabels(field.element)

  return {
    answerKind: toCorpusAnswerKind(corpusFieldType, optionLabels, value),
    answerText: profileValueToText(value),
    answerValue: value,
    fieldType: corpusFieldType,
    // Stays null until the country-aware classifier exists. Nothing on either
    // side of the wire infers one: a wrong enum poisons the answer history for
    // every country sharing the question, and a null is backfillable.
    labelEnumId: null,
    normalizedQuestion,
    profileField: capture.profileField,
    questionText,
    resolverOutcome: capture.resolverOutcome,
    section: capture.section,
    source: capture.source,
    sourceAnswerId: null,
  }
}

const collectRecords = (state: FormCaptureState): AnswerCaptureRecord[] => {
  const records: AnswerCaptureRecord[] = []
  for (const field of state.fields) {
    const record = buildRecord(field)
    if (record) records.push(record)
  }
  return records
}

// Everything is read and handed off BEFORE detection runs, not after.
//
// Detection waits up to 8 seconds and then reads `location.href`. Both halves of
// that are wrong on a real submit: a classic full-page POST destroys this content
// script long before the deadline, taking the buffered fields with it, and an
// SPA that reaches a confirmation route has already replaced the URL the answers
// belong to with a `/thank-you` that identifies no job.
//
// So submit-time snapshots the page URL and serialises every field, and stages
// that batch with the background worker — which outlives the page. Detection then
// only decides whether the staged batch commits or is discarded.
const onSubmitForState = (state: FormCaptureState) => async () => {
  if (state.pendingDetection) return
  state.pendingDetection = true

  const applicationUrl = location.href
  const ats = detectAts()
  const records = collectRecords(state)

  if (records.length === 0) {
    state.pendingDetection = false
    return
  }

  let stageId: string
  try {
    const staged = await stageCaptureViaBridge({ ats, applicationUrl, records })
    if (!staged.ok || !staged.stageId) {
      state.pendingDetection = false
      return
    }
    stageId = staged.stageId
    state.stageId = stageId
  } catch {
    state.pendingDetection = false
    return
  }

  try {
    const outcome = await detectSubmitOutcome(state.form, ats)
    if (outcome === 'success') {
      await commitCaptureViaBridge(stageId)
    } else {
      // Detection leans toward false positives by design, so `unknown` is not a
      // silent drop: the background worker still commits a stage that a
      // top-level navigation cut short, which is the case detection cannot
      // observe from inside a page that no longer exists.
      await discardCaptureViaBridge(stageId, outcome)
    }
  } finally {
    state.stageId = null
    state.pendingDetection = false
  }
}

const attachSubmitListener = (state: FormCaptureState): void => {
  if (state.listenerAttached) return
  state.listenerAttached = true
  const handler = onSubmitForState(state)
  const submitHandler = () => {
    void handler()
  }
  const buttonHandler = (e: Event) => {
    const target = e.target as HTMLElement | null
    if (!target) return
    const btn = target.closest<HTMLElement>(
      'button, input[type="submit"], [role="button"]',
    )
    if (!btn) return
    if (!state.form.contains(btn)) return
    const type = btn.getAttribute('type')
    const looksSubmit =
      type === 'submit' ||
      /\b(submit|apply|send)\b/i.test(btn.textContent ?? '') ||
      /\b(submit|apply|send)\b/i.test(btn.getAttribute('aria-label') ?? '')
    if (!looksSubmit) return
    void handler()
  }
  state.submitHandler = submitHandler
  state.buttonHandler = buttonHandler
  state.form.addEventListener('submit', submitHandler)
  document.addEventListener('click', buttonHandler, true)
}

const detachSubmitListeners = (state: FormCaptureState): void => {
  if (state.submitHandler) {
    state.form.removeEventListener('submit', state.submitHandler)
  }
  if (state.buttonHandler) {
    document.removeEventListener('click', state.buttonHandler, true)
  }
  state.submitHandler = null
  state.buttonHandler = null
  state.listenerAttached = false
}

export const registerFieldForCapture = (field: BaseField): void => {
  const form = findEnclosingForm(field.element)
  if (!form) return
  let state = formStates.get(form)
  if (!state) {
    state = {
      buttonHandler: null,
      fields: new Set(),
      form,
      listenerAttached: false,
      pendingDetection: false,
      stageId: null,
      submitHandler: null,
    }
    formStates.set(form, state)
    trackedForms.add(form)
  }
  state.fields.add(field)
  fieldForms.set(field, form)
  attachSubmitListener(state)
}

export const unregisterFieldFromCapture = (field: BaseField): void => {
  const form = fieldForms.get(field) ?? findEnclosingForm(field.element)
  if (!form) return
  const state = formStates.get(form)
  if (!state) return
  state.fields.delete(field)
  fieldForms.delete(field)
  if (state.fields.size === 0) {
    detachSubmitListeners(state)
    formStates.delete(form)
    trackedForms.delete(form)
  }
}

export const teardownAllCaptureForms = (): void => {
  for (const form of trackedForms) {
    const state = formStates.get(form)
    if (state) {
      for (const field of state.fields) fieldForms.delete(field)
      detachSubmitListeners(state)
    }
    formStates.delete(form)
  }
  trackedForms.clear()
}

import { submitCapture } from '~/bridge/mainBridge'
import { findEnclosingForm, submitButtonFor } from './submitTarget'
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
  submitted: boolean
  submitHandler: ((event: Event) => void) | null
}

const formStates = new WeakMap<HTMLElement, FormCaptureState>()
const trackedForms = new Set<HTMLElement>()
const fieldForms = new WeakMap<BaseField, HTMLElement>()

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

const SUBMIT_DEBOUNCE_MS = 1_000

const onSubmitForState = (state: FormCaptureState) => () => {
  if (state.submitted) return
  const records = collectRecords(state)
  if (records.length === 0) return
  state.submitted = true
  window.setTimeout(() => {
    state.submitted = false
  }, SUBMIT_DEBOUNCE_MS)
  submitCapture(records)
}

const attachSubmitListener = (state: FormCaptureState): void => {
  if (state.listenerAttached) return
  state.listenerAttached = true
  const handler = onSubmitForState(state)
  const submitHandler = () => {
    handler()
  }
  const buttonHandler = (e: Event) => {
    const target = e.target as HTMLElement | null
    if (!target) return
    const btn = submitButtonFor(target)
    if (!btn || !state.form.contains(btn)) return
    handler()
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
      submitHandler: null,
      submitted: false,
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

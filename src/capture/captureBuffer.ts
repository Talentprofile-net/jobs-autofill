import { detectAts } from '~/core/ats'
import { detectSubmitOutcome } from './submitDetection'
import { flushAnswersViaBridge } from '~/bridge/mainBridge'
import type { BaseField } from '~/field/baseField'
import type { AnswerCaptureRecord } from '~/bridge/types'

type FormCaptureState = {
  form: HTMLElement
  fields: Set<BaseField>
  listenerAttached: boolean
  pendingDetection: boolean
}

const formStates = new WeakMap<HTMLElement, FormCaptureState>()
const trackedForms = new Set<HTMLElement>()

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
  const { coerceToProfileValueShape, profileValueToText } = require('~/resolver/captureCoercion')
  const value = coerceToProfileValueShape(capture.currentValue, capture.fieldType)
  if (!value) return null
  return {
    answerKind: value.kind,
    answerText: profileValueToText(value),
    answerValue: value,
    fieldName: capture.fieldName,
    fieldType: capture.fieldType,
    profileField: capture.profileField,
    resolverOutcome: capture.resolverOutcome,
    section: capture.section,
    source: capture.source,
    sourceAnswerId: null,
  }
}

const flushForm = async (state: FormCaptureState): Promise<void> => {
  const records: AnswerCaptureRecord[] = []
  for (const field of state.fields) {
    const record = buildRecord(field)
    if (record) records.push(record)
  }
  if (records.length === 0) return
  await flushAnswersViaBridge({
    ats: detectAts(),
    pageUrl: location.href,
    records,
  })
}

const onSubmitForState = (state: FormCaptureState) => async () => {
  if (state.pendingDetection) return
  state.pendingDetection = true
  try {
    const outcome = await detectSubmitOutcome(state.form, detectAts())
    if (outcome === 'success') {
      await flushForm(state)
    }
  } finally {
    state.pendingDetection = false
  }
}

const attachSubmitListener = (state: FormCaptureState): void => {
  if (state.listenerAttached) return
  state.listenerAttached = true
  const handler = onSubmitForState(state)
  state.form.addEventListener('submit', () => {
    void handler()
  })
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
  document.addEventListener('click', buttonHandler, true)
}

export const registerFieldForCapture = (field: BaseField): void => {
  const form = findEnclosingForm(field.element)
  if (!form) return
  let state = formStates.get(form)
  if (!state) {
    state = {
      fields: new Set(),
      form,
      listenerAttached: false,
      pendingDetection: false,
    }
    formStates.set(form, state)
    trackedForms.add(form)
  }
  state.fields.add(field)
  attachSubmitListener(state)
}

export const unregisterFieldFromCapture = (field: BaseField): void => {
  const form = findEnclosingForm(field.element)
  if (!form) return
  const state = formStates.get(form)
  if (!state) return
  state.fields.delete(field)
  if (state.fields.size === 0) {
    formStates.delete(form)
    trackedForms.delete(form)
  }
}

export const teardownAllCaptureForms = (): void => {
  for (const form of trackedForms) formStates.delete(form)
  trackedForms.clear()
}
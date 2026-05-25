import { setNativeInputValue } from '~/core/reactProps'

const isInput = (el: HTMLElement): el is HTMLInputElement =>
  el instanceof HTMLInputElement

const isTextarea = (el: HTMLElement): el is HTMLTextAreaElement =>
  el instanceof HTMLTextAreaElement

const isContentEditable = (el: HTMLElement): boolean =>
  el.isContentEditable

const dispatchInputEvents = (el: HTMLElement) => {
  el.dispatchEvent(new InputEvent('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

const truncateForInput = (
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): string => {
  const max = el.maxLength
  if (typeof max !== 'number' || max <= 0) return value
  if (value.length <= max) return value
  return value.slice(0, max)
}

const computePrefix = (before: string): string => {
  if (before.length === 0) return ''
  const lastChar = before[before.length - 1]
  if (lastChar === '\n' || lastChar === ' ') return ''
  return ' '
}

const insertAtCaret = (
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void => {
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? el.value.length
  const current = el.value
  const before = current.slice(0, start)
  const after = current.slice(end)
  const prefix = computePrefix(before)
  const desired = `${before}${prefix}${value}${after}`
  const finalValue = truncateForInput(el, desired)
  setNativeInputValue(el, finalValue)
  const caret = Math.min(
    before.length + prefix.length + value.length,
    finalValue.length,
  )
  el.selectionStart = caret
  el.selectionEnd = caret
  dispatchInputEvents(el)
}

const appendBrSeparatedText = (target: HTMLElement, value: string): void => {
  const lines = value.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) target.appendChild(document.createElement('br'))
    if (lines[i].length > 0) target.appendChild(document.createTextNode(lines[i]))
  }
}

const insertIntoContentEditable = (el: HTMLElement, value: string): void => {
  el.focus()
  const lines = value.split('\n')
  const sel = window.getSelection()
  if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
    const range = sel.getRangeAt(0)
    range.deleteContents()
    const frag = document.createDocumentFragment()
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) frag.appendChild(document.createElement('br'))
      if (lines[i].length > 0) frag.appendChild(document.createTextNode(lines[i]))
    }
    const lastNode = frag.lastChild
    range.insertNode(frag)
    if (lastNode) {
      const newRange = document.createRange()
      newRange.setStartAfter(lastNode)
      newRange.collapse(true)
      sel.removeAllRanges()
      sel.addRange(newRange)
    }
  } else {
    appendBrSeparatedText(el, value)
  }
  el.dispatchEvent(
    new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }),
  )
}

const findEditableTarget = (field: HTMLElement): HTMLElement | null => {
  if (isInput(field) || isTextarea(field) || isContentEditable(field)) return field
  const sel =
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="file"]):not([type="password"]),' +
    'textarea, [contenteditable="true"], [contenteditable=""]'
  return field.querySelector<HTMLElement>(sel)
}

export type InsertResult = {
  inserted: boolean
  truncated: boolean
  maxLength: number | null
}

export const insertIntoField = (field: HTMLElement, value: string): InsertResult => {
  const target = findEditableTarget(field)
  if (!target) return { inserted: false, truncated: false, maxLength: null }
  target.focus()
  if (isInput(target) || isTextarea(target)) {
    const maxLength = target.maxLength > 0 ? target.maxLength : null
    const start = target.selectionStart ?? target.value.length
    const end = target.selectionEnd ?? target.value.length
    const projectedLen = target.value.length - (end - start) + value.length
    const truncated = maxLength !== null && projectedLen > maxLength
    insertAtCaret(target, value)
    return { inserted: true, truncated, maxLength }
  }
  if (isContentEditable(target)) {
    insertIntoContentEditable(target, value)
    return { inserted: true, truncated: false, maxLength: null }
  }
  return { inserted: false, truncated: false, maxLength: null }
}
import { FIELD_MARKER_ATTR } from '~/config'
import { associatedLabels, isRenderedElement, precedingSiblingText, resolveFieldLabel, resolveGroupLabel } from '~/adapters/generic/labelResolver'
import { contextSection } from '~/adapters/generic/sections'
import { hasConcealingAncestor } from '~/core/concealment'
import { hasDisplayedAncestor } from '~/core/fileAttach'
import { resolveLabelledByText } from '~/core/labelledBy'
import { composedParent, isAttached, querySelectorAllDeep, rootQueryScope } from '~/core/shadowDom'
import { isThirdPartySection } from '~/resolver/questionTopics'
import type { FieldResolveRequest } from './types'

export type FieldRequest = FieldResolveRequest & { requestId: string }

const FILE_FIELD_TYPES: ReadonlySet<string> = new Set(['FileUpload', 'SingleFileUpload', 'MultiFileUpload'])
const CONTROL_SELECTOR = 'input:not([type="hidden"]), select, textarea, button, [role="combobox"], [role="textbox"], [role="radiogroup"], [role="radio"], [role="checkbox"], [contenteditable="true"], [contenteditable=""]'
const NAMING_ATTRIBUTES = ['aria-label', 'placeholder', 'title', 'name']
const MAX_CONTROLS = 40
const MAX_ANCESTORS = 8
const MAX_SIBLING_DEPTH = 5
const MAX_TEXT_CHARS = 5000

const grounded = (text: string): string => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

const isFieldRequest = (value: unknown): value is FieldRequest => {
  if (!value || typeof value !== 'object') return false
  const { fieldName, fieldType, requestId, section } = value as Record<string, unknown>
  return typeof fieldName === 'string' && typeof fieldType === 'string' && typeof requestId === 'string' && typeof section === 'string'
}

const markedField = (requestId: string): HTMLElement | null => {
  const marked = querySelectorAllDeep<HTMLElement>(document, `[${FIELD_MARKER_ATTR}="${CSS.escape(requestId)}"]`)
  return marked.length === 1 && isAttached(marked[0]) ? marked[0] : null
}

const isFileInput = (el: Element): el is HTMLInputElement => el instanceof HTMLInputElement && el.type === 'file'

const controlsOf = (field: HTMLElement): HTMLElement[] =>
  [field, ...querySelectorAllDeep<HTMLElement>(field, CONTROL_SELECTOR)].slice(0, MAX_CONTROLS)

const isShownField = (field: HTMLElement): boolean =>
  !hasConcealingAncestor(field) && (isRenderedElement(field) || hasDisplayedAncestor(field))

const typeMatches = (field: HTMLElement, fieldType: string): boolean =>
  FILE_FIELD_TYPES.has(fieldType) ? controlsOf(field).some(isFileInput) : !isFileInput(field)

const ancestorsOf = (field: HTMLElement): Element[] => {
  const out: Element[] = []
  for (let node = composedParent(field); node instanceof Element && out.length < MAX_ANCESTORS; node = composedParent(node)) {
    if (node === document.body || node === document.documentElement) break
    out.push(node)
  }
  return out
}

const ownsOtherField = (node: Element, field: HTMLElement): boolean =>
  querySelectorAllDeep(node, `[${FIELD_MARKER_ATTR}]`).some((el) => el !== field && !field.contains(el))

const containsControl = (node: Element): boolean => node.matches(CONTROL_SELECTOR) || querySelectorAllDeep(node, CONTROL_SELECTOR).length > 0

const blockTexts = (el: Element): string[] => {
  const shown = el instanceof HTMLElement ? el.innerText : ''
  return [shown ?? '', el.textContent ?? ''].map((text) => text.slice(0, MAX_TEXT_CHARS))
}

const attributeTexts = (el: Element): string[] => [
  ...NAMING_ATTRIBUTES.map((name) => el.getAttribute(name) ?? ''),
  resolveLabelledByText(el.getAttribute('aria-labelledby'), el),
]

const forLabelTexts = (el: Element): string[] => {
  const id = el.getAttribute('id')
  if (!id) return []
  return Array.from(rootQueryScope(el).querySelectorAll(`label[for="${CSS.escape(id)}"]`)).flatMap(blockTexts)
}

const controlTexts = (el: HTMLElement): string[] => [
  ...attributeTexts(el),
  ...forLabelTexts(el),
  ...associatedLabels(el),
  resolveFieldLabel(el),
  resolveGroupLabel(el),
  precedingSiblingText(el),
]

const legendTexts = (node: Element): string[] => {
  const legend = node.tagName === 'FIELDSET' ? node.querySelector(':scope > legend') : null
  return [...(legend ? blockTexts(legend) : []), ...attributeTexts(node)]
}

const precedingTexts = (node: Element): string[] => {
  const out: string[] = []
  for (let sib = node.previousElementSibling; sib && !containsControl(sib); sib = sib.previousElementSibling) out.push(...blockTexts(sib))
  return out
}

const labelEvidence = (field: HTMLElement): string[] => {
  const ancestors = ancestorsOf(field)
  const shared = ancestors.findIndex((node) => ownsOtherField(node, field))
  const exclusive = shared < 0 ? ancestors : ancestors.slice(0, shared)
  return [
    ...blockTexts(field),
    ...controlsOf(field).flatMap(controlTexts),
    ...exclusive.flatMap(blockTexts),
    ...ancestors.flatMap(legendTexts),
    ...[field, ...ancestors.slice(0, MAX_SIBLING_DEPTH)].flatMap(precedingTexts),
  ]
    .map(grounded)
    .filter(Boolean)
}

const labelMatches = (field: HTMLElement, fieldName: string): boolean => {
  const wanted = grounded(fieldName)
  return wanted.length > 0 && labelEvidence(field).some((text) => text.includes(wanted))
}

export const isBoundField = (request: unknown): request is FieldRequest => {
  if (!isFieldRequest(request)) return false
  const field = markedField(request.requestId)
  if (!field || !typeMatches(field, request.fieldType)) return false
  if (!isShownField(field)) return false
  if (isThirdPartySection(contextSection(field))) return false
  return labelMatches(field, request.fieldName)
}

export const claimBoundFields = (requests: unknown[], served: Set<string>): Array<FieldRequest | null> =>
  requests.map((request) => {
    if (!isBoundField(request) || served.has(request.requestId)) return null
    served.add(request.requestId)
    return request
  })

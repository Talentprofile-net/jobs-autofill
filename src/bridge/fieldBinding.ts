import { FIELD_MARKER_ATTR } from '~/config'
import { fileQuestionLabel } from '~/adapters/generic/fileLabel'
import { groupLabel, groupLabelWithContainerFallback, leadingText } from '~/adapters/generic/groupLabel'
import { associatedLabels, blockText, isRenderedElement, precedingSiblingText, resolveFieldLabel, resolveGroupLabel } from '~/adapters/generic/labelResolver'
import { createEntrySectionReader, refusedContext } from '~/adapters/generic/sections'
import { withoutHiddenLabelMarker } from '~/adapters/greenhouseClassic/hiddenLabelMarker'
import { SECTION_WRAPPER_XPATH, wrapperSectionNumbers } from '~/adapters/greenhouseClassic/sections'
import { sectionNumbers } from '~/adapters/greenhouseReact/sectionNumbers'
import { fixedFieldName } from '~/adapters/workday/fixedFieldName'
import { createSectionReader } from '~/adapters/workday/sectionKind'
import { hasConcealingAncestor } from '~/core/concealment'
import { hasDisplayedAncestor } from '~/core/fileAttach'
import { getElements } from '~/core/getElements'
import { resolveLabelledByText } from '~/core/labelledBy'
import { composedParent, isAttached, querySelectorAllDeep } from '~/core/shadowDom'
import type { AtsName } from '~/field/types'
import { isRefusedSection } from '~/resolver/questionTopics'
import { parseSection } from '~/resolver/sectionParser'
import type { FieldResolveRequest } from './types'

export type FieldRequest = FieldResolveRequest & { requestId: string }

type FieldSnapshot = {
  element: HTMLElement
  labels: ReadonlySet<string>
  types: ReadonlySet<string>
  section: string
}

export type FieldAllowlist = ReadonlyMap<string, FieldSnapshot>

type ControlKind = 'file' | 'text' | 'dropdown' | 'choice' | 'date' | 'other'

const FILE_TYPES = ['FileUpload', 'SingleFileUpload', 'MultiFileUpload']
const TEXT_TYPES = ['TextInput', 'ContentEditable', 'PasswordInput']
const DROPDOWN_TYPES = ['SimpleDropdown', 'MultiSelect', 'MultiSearchableDropdown']
const CHOICE_TYPES = ['SingleCheckbox', 'MultiCheckbox', 'RadioGroup', 'BooleanRadio']
const DATE_TYPES = ['MonthYear', 'MonthDayYear', 'Year']

const TYPES_BY_KIND: Record<Exclude<ControlKind, 'file' | 'other'>, string[]> = {
  choice: CHOICE_TYPES,
  date: [...DATE_TYPES, ...TEXT_TYPES],
  dropdown: [...DROPDOWN_TYPES, ...DATE_TYPES],
  text: [...TEXT_TYPES, ...DROPDOWN_TYPES, ...DATE_TYPES],
}

const CONTROL_SELECTOR = 'input:not([type="hidden"]), select, textarea, button, [contenteditable="true"], [contenteditable=""], [role="combobox"], [role="textbox"], [role="radio"], [role="checkbox"], [role="radiogroup"], [role="switch"], [role="listbox"], [role="spinbutton"]'
const NAMING_SELECTOR = 'label, legend, [class*="label"], [placeholder]'
const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set(['', 'text', 'email', 'tel', 'url', 'number', 'search', 'password'])
const IGNORED_INPUT_TYPES: ReadonlySet<string> = new Set(['submit', 'button', 'reset', 'image'])
const CHOICE_ROLES: ReadonlySet<string> = new Set(['radio', 'checkbox', 'radiogroup', 'switch'])
const MAX_CONTROLS = 64
const MAX_ANCESTORS = 8

const canonical = (text: string): string => text.normalize('NFKC').replace(/\s+/g, ' ').trim()

const isFieldRequest = (value: unknown): value is FieldRequest => {
  if (!value || typeof value !== 'object') return false
  const { fieldName, fieldType, requestId, section } = value as Record<string, unknown>
  return typeof fieldName === 'string' && typeof fieldType === 'string' && typeof requestId === 'string' && typeof section === 'string'
}

const markedElements = (requestId: string): HTMLElement[] =>
  querySelectorAllDeep<HTMLElement>(document, `[${FIELD_MARKER_ATTR}="${CSS.escape(requestId)}"]`)

const controlKind = (el: HTMLElement): ControlKind | null => {
  const role = el.getAttribute('role') ?? ''
  if (el.tagName === 'INPUT') {
    const type = (el.getAttribute('type') ?? '').trim().toLowerCase()
    if (type === 'file') return 'file'
    if (type === 'checkbox' || type === 'radio') return 'choice'
    if (type === 'date' || type === 'month') return 'date'
    if (IGNORED_INPUT_TYPES.has(type)) return null
    if (role === 'combobox') return 'dropdown'
    return TEXT_INPUT_TYPES.has(type) ? 'text' : 'other'
  }
  if (CHOICE_ROLES.has(role)) return 'choice'
  if (el.tagName === 'SELECT' || role === 'combobox' || role === 'listbox') return 'dropdown'
  if (el.tagName === 'BUTTON') {
    if (el.hasAttribute('aria-pressed')) return 'choice'
    return el.hasAttribute('aria-haspopup') ? 'dropdown' : null
  }
  return 'text'
}

const allowedTypes = (field: HTMLElement, controls: HTMLElement[]): ReadonlySet<string> => {
  const kinds = new Set(controls.map(controlKind).filter((kind): kind is ControlKind => kind !== null))
  if (kinds.size === 0 || kinds.has('other')) return new Set()
  if (kinds.has('file')) return kinds.size === 1 ? new Set(FILE_TYPES) : new Set()
  const nested = querySelectorAllDeep(field, `[${FIELD_MARKER_ATTR}]`).length > 0
  if (nested) return new Set()
  return new Set([...kinds].flatMap((kind) => (kind === 'file' || kind === 'other' ? [] : TYPES_BY_KIND[kind])))
}

const composedAncestors = (field: HTMLElement): HTMLElement[] => {
  const out: HTMLElement[] = []
  for (let node = composedParent(field); node instanceof HTMLElement && out.length < MAX_ANCESTORS; node = composedParent(node)) {
    if (node === document.body) break
    out.push(node)
  }
  return out
}

const innerTextOf = (el: Element): string => (el instanceof HTMLElement ? el.innerText ?? el.textContent ?? '' : el.textContent ?? '')

const ownTexts = (el: HTMLElement): string[] => [
  resolveFieldLabel(el),
  ...associatedLabels(el),
  resolveGroupLabel(el),
  precedingSiblingText(el),
  blockText(el),
  groupLabel(el),
  groupLabelWithContainerFallback(el),
  el.getAttribute('aria-label') ?? '',
  el.getAttribute('placeholder') ?? '',
  resolveLabelledByText(el.getAttribute('aria-labelledby'), el),
  el.tagName === 'INPUT' && el.getAttribute('type') === 'file' ? fileQuestionLabel(el) : '',
]

const labelCandidates = (field: HTMLElement, controls: HTMLElement[]): ReadonlySet<string> => {
  const naming = querySelectorAllDeep<HTMLElement>(field, NAMING_SELECTOR).flatMap((el) => [innerTextOf(el), el.getAttribute('placeholder') ?? ''])
  const ancestors = composedAncestors(field).flatMap((node) => [resolveFieldLabel(node), leadingText(node, [field]), precedingSiblingText(node)])
  const texts = [...[field, ...controls].flatMap(ownTexts), ...naming, ...ancestors, fixedFieldName(field) ?? '']
  return new Set(texts.flatMap((text) => [canonical(text), canonical(withoutHiddenLabelMarker(text))]).filter(Boolean))
}

const isShownField = (field: HTMLElement): boolean =>
  !hasConcealingAncestor(field) && (isRenderedElement(field) || hasDisplayedAncestor(field))

const nearestNumbered = (field: HTMLElement, numbers: Map<HTMLElement, string>): string => {
  for (let node: Node | null = field; node; node = composedParent(node)) {
    const value = node instanceof HTMLElement ? numbers.get(node) : undefined
    if (value) return value
  }
  return ''
}

const createSectionOf = (ats: AtsName): ((field: HTMLElement) => string) => {
  if (ats === 'workday') return createSectionReader()
  if (ats === 'greenhouseReact') {
    let numbers: Map<HTMLElement, string> | null = null
    return (field) => nearestNumbered(field, (numbers ??= sectionNumbers()))
  }
  if (ats === 'greenhouseClassic') {
    let numbers: Map<HTMLElement, string> | null = null
    return (field) => nearestNumbered(field, (numbers ??= new Map(getElements(document, SECTION_WRAPPER_XPATH).flatMap((wrapper) => [...wrapperSectionNumbers(wrapper)]))))
  }
  return createEntrySectionReader()
}

const snapshotField = (requestId: string, sectionOf: (field: HTMLElement) => string): FieldSnapshot | null => {
  const marked = markedElements(requestId)
  if (marked.length !== 1) return null
  const [element] = marked
  if (!isAttached(element) || !isShownField(element) || isRefusedSection(refusedContext(element))) return null
  const descendants = querySelectorAllDeep<HTMLElement>(element, CONTROL_SELECTOR).filter((el) => controlKind(el) !== null)
  const controls = element.matches(CONTROL_SELECTOR) && controlKind(element) !== null ? [element, ...descendants] : descendants
  if (controls.length > MAX_CONTROLS) return null
  const types = allowedTypes(element, controls)
  if (types.size === 0) return null
  return { element, labels: labelCandidates(element, descendants), section: sectionOf(element), types }
}

export const snapshotFieldAllowlist = (ats: AtsName): FieldAllowlist => {
  const sectionOf = createSectionOf(ats)
  const ids = new Set(querySelectorAllDeep(document, `[${FIELD_MARKER_ATTR}]`).map((el) => el.getAttribute(FIELD_MARKER_ATTR) ?? ''))
  const out = new Map<string, FieldSnapshot>()
  for (const requestId of ids) {
    const snapshot = requestId ? snapshotField(requestId, sectionOf) : null
    if (snapshot) out.set(requestId, snapshot)
  }
  return out
}

const sameSection = (claimed: string, owned: string): boolean => {
  const a = parseSection(claimed)
  const b = parseSection(owned)
  return a.type === b.type && a.index === b.index
}

const bindRequest = (request: unknown, allowlist: FieldAllowlist): FieldRequest | null => {
  if (!isFieldRequest(request)) return null
  const snapshot = allowlist.get(request.requestId)
  if (!snapshot) return null
  const marked = markedElements(request.requestId)
  if (marked.length !== 1 || marked[0] !== snapshot.element || !isAttached(snapshot.element)) return null
  if (!snapshot.types.has(request.fieldType) || !snapshot.labels.has(canonical(request.fieldName))) return null
  if (!sameSection(request.section, snapshot.section)) return null
  return { fieldName: request.fieldName, fieldType: request.fieldType, requestId: request.requestId, section: snapshot.section }
}

export const claimBoundFields = (requests: unknown[], allowlist: FieldAllowlist, served: Set<string>): Array<FieldRequest | null> =>
  requests.map((request) => {
    const bound = bindRequest(request, allowlist)
    if (!bound || served.has(bound.requestId)) return null
    served.add(bound.requestId)
    return bound
  })

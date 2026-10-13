import { FIELD_MARKER_ATTR } from '~/config'
import { refusedContext } from '~/adapters/generic/sections'
import { isAttached, querySelectorAllDeep } from '~/core/shadowDom'
import { describeFields, type FieldDescription } from '~/field/describe/describeFields'
import type { AtsName } from '~/field/types'
import { isRefusedSection } from '~/resolver/questionTopics'
import type { FieldResolveRequest } from './types'

export type FieldRequest = FieldResolveRequest & { requestId: string }

type OwnedField = Omit<FieldDescription, 'element'> & { marker: string | null }

export type FieldAllowlist = ReadonlyMap<HTMLElement, OwnedField>

export type ServedFields = { requestIds: Set<string>; elements: WeakSet<HTMLElement> }

export const createServedFields = (): ServedFields => ({ elements: new WeakSet(), requestIds: new Set() })

const canonical = (text: string): string => text.normalize('NFKC').replace(/\s+/g, ' ').trim()

const isFieldRequest = (value: unknown): value is FieldRequest => {
  if (!value || typeof value !== 'object') return false
  const { fieldName, fieldType, requestId, section } = value as Record<string, unknown>
  return typeof fieldName === 'string' && typeof fieldType === 'string' && typeof requestId === 'string' && typeof section === 'string'
}

const isReleasable = ({ element, fillable, section, visible }: FieldDescription): boolean =>
  visible && fillable && isAttached(element) && !isRefusedSection(section) && !isRefusedSection(refusedContext(element))

export const snapshotFieldAllowlist = (ats: AtsName): FieldAllowlist => {
  const described = describeFields(ats)
  const seen = new Map<HTMLElement, number>()
  for (const { element } of described) seen.set(element, (seen.get(element) ?? 0) + 1)
  const out = new Map<HTMLElement, OwnedField>()
  for (const description of described) {
    if (seen.get(description.element) !== 1 || !isReleasable(description)) continue
    const { element, ...owned } = description
    out.set(element, { ...owned, marker: element.getAttribute(FIELD_MARKER_ATTR) })
  }
  return out
}

const correlatedElement = (requestId: string): HTMLElement | null => {
  const marked = querySelectorAllDeep<HTMLElement>(document, `[${FIELD_MARKER_ATTR}="${CSS.escape(requestId)}"]`)
  return marked.length === 1 ? marked[0] : null
}

const sameField = (a: OwnedField, b: OwnedField): boolean =>
  a.marker === b.marker &&
  canonical(a.fieldName) === canonical(b.fieldName) &&
  a.fieldType === b.fieldType &&
  a.section === b.section &&
  a.visible === b.visible &&
  a.fillable === b.fillable

const matchesRequest = (request: FieldRequest, owned: OwnedField): boolean =>
  owned.marker === request.requestId &&
  canonical(request.fieldName) === canonical(owned.fieldName) && request.fieldType === owned.fieldType && request.section === owned.section

const boundField = (request: FieldRequest, confirmed: FieldAllowlist, current: FieldAllowlist): { element: HTMLElement; owned: OwnedField } | null => {
  const element = correlatedElement(request.requestId)
  if (!element) return null
  const owned = confirmed.get(element)
  const now = current.get(element)
  if (!owned || !now || !sameField(owned, now) || !matchesRequest(request, owned)) return null
  return { element, owned }
}

export const claimBoundFields = (
  requests: unknown[],
  confirmed: FieldAllowlist,
  current: FieldAllowlist,
  served: ServedFields,
): Array<FieldRequest | null> =>
  requests.map((request) => {
    if (!isFieldRequest(request)) return null
    const bound = boundField(request, confirmed, current)
    if (!bound || served.requestIds.has(request.requestId) || served.elements.has(bound.element)) return null
    served.requestIds.add(request.requestId)
    served.elements.add(bound.element)
    return { fieldName: bound.owned.fieldName, fieldType: bound.owned.fieldType, requestId: request.requestId, section: bound.owned.section }
  })

export const isStillBound = (request: FieldRequest, confirmed: FieldAllowlist, current: FieldAllowlist): boolean =>
  boundField(request, confirmed, current) !== null

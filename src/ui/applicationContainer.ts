import { composedContains, composedParent } from '~/core/shadowDom'
import { CV_FIELD_TYPE, isResumeFieldLabel } from '~/resolver/cvFile'

const MIN_FIELDS = 3
const SHELL_TAGS = new Set(['HTML', 'BODY', 'IFRAME'])
const UNRELATED = 'nav, header, footer, [role="navigation"], [role="banner"], [role="contentinfo"]'
const UNRELATED_HINT = /(cookie|consent|onetrust|gdpr|newsletter|banner)/i
const TEXT_LIKE = 'input:not([type]), input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"], textarea, [role="textbox"], [role="combobox"]'

const hint = (el: Element): string => `${el.id} ${el.getAttribute('class') ?? ''} ${el.getAttribute('aria-label') ?? ''}`

const isUnrelated = (el: Element): boolean => {
  for (let node: Node | null = el; node; node = composedParent(node)) {
    if (node instanceof Element && (node.matches(UNRELATED) || UNRELATED_HINT.test(hint(node)))) return true
  }
  return false
}

const asElement = (node: Node | null): HTMLElement | null => {
  if (node instanceof ShadowRoot) return node.host as HTMLElement
  return node instanceof HTMLElement ? node : null
}

const lowestCommonAncestor = (els: Element[]): HTMLElement | null => {
  let node: Node | null = els[0] ? composedParent(els[0]) : null
  while (node && !els.every((el) => composedContains(node!, el))) node = composedParent(node)
  return asElement(node)
}

const childHolding = (parent: Element, els: Element[]): { child: Element; members: Element[] } | null => {
  let best: { child: Element; members: Element[] } | null = null
  const children = [...Array.from(parent.children), ...(parent.shadowRoot ? Array.from(parent.shadowRoot.children) : [])]
  for (const child of children) {
    const members = els.filter((el) => composedContains(child, el))
    if (!best || members.length > best.members.length) best = { child, members }
  }
  return best
}

const isTextLike = (el: Element): boolean => el.matches(TEXT_LIKE) || el.querySelector(TEXT_LIKE) !== null

export const applicationContainerFor = (fieldElements: Element[]): HTMLElement | null => {
  let members = fieldElements.filter((el) => el.isConnected && !isUnrelated(el))
  if (members.length < MIN_FIELDS || !members.some(isTextLike)) return null
  let container = lowestCommonAncestor(members)
  for (let guard = 0; container && SHELL_TAGS.has(container.tagName) && guard < 8; guard++) {
    const best = childHolding(container, members)
    if (!best || best.members.length < MIN_FIELDS) return null
    members = best.members
    container = members.length === 1 ? asElement(composedParent(members[0])) : lowestCommonAncestor(members)
  }
  if (!container || SHELL_TAGS.has(container.tagName) || isUnrelated(container)) return null
  if (!members.some(isTextLike)) return null
  return container
}

export type EvidenceField = {
  element: Element
  fieldType: string
  fieldName: string
  attached: boolean
  displayed: boolean
}

export const applicationEvidenceElements = (fields: EvidenceField[]): Element[] =>
  fields
    .filter((field) => field.attached && field.displayed)
    .filter((field) => field.fieldType !== CV_FIELD_TYPE || isResumeFieldLabel(field.fieldName))
    .map((field) => field.element)

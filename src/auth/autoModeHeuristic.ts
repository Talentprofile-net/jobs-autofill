import { APPLICATION_KEYWORDS } from '~/config'
import { isConcealedControl } from '~/core/concealment'
import { closestComposed, composedContains, composedParent, getElementByIdInScope, querySelectorAllDeep } from '~/core/shadowDom'

export type AutoModeVerdict = 'application' | 'notesOnly'

const CONTROL_SELECTOR = [
  'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"])',
  'textarea',
  'select',
  '[role="combobox"]',
  '[role="textbox"]',
  '[role="radiogroup"]',
  '[contenteditable="true"]',
  '[contenteditable=""]',
].join(', ')

const SEARCH_CONTEXT = 'form[role="search"], [role="search"], header, nav'
const SEARCH_NAME = /^(q|query|keywords?|search|s|term|what|where)$/i

type Kind = 'name' | 'email' | 'phone' | 'location' | 'link' | 'resume'

const KIND_PATTERNS: Array<[Kind, RegExp]> = [
  ['email', /e-?mail/i],
  ['phone', /\b(phone|mobile|cell|telephone)\b/i],
  ['name', /\b(first|last|full|given|family|legal|preferred)\s*name\b|^\s*name\s*\*?\s*$/i],
  ['location', /\b(city|location|address|country|postal|zip)\b/i],
  ['link', /\b(linkedin|github|portfolio|website)\b/i],
  ['resume', /\b(resume|résumé|cv|curriculum vitae)\b/i],
]

const AUTOCOMPLETE_KIND: Record<string, Kind> = {
  'additional-name': 'name',
  email: 'email',
  'family-name': 'name',
  'given-name': 'name',
  name: 'name',
  'postal-code': 'location',
  tel: 'phone',
  'tel-national': 'phone',
}

const isShown = (el: Element): boolean => {
  const probe = el as Element & { checkVisibility?: (options?: object) => boolean }
  if (typeof probe.checkVisibility === 'function' && !probe.checkVisibility({ opacityProperty: true, visibilityProperty: true })) {
    return false
  }
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

const labelText = (el: Element): string => {
  const parts: string[] = []
  const id = el.getAttribute('id')
  const root = el.getRootNode() as Document | ShadowRoot
  if (id && 'querySelector' in root) parts.push(text(root.querySelector(`label[for="${CSS.escape(id)}"]`)))
  parts.push(text(el.closest('label')))
  for (const ref of (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)) {
    parts.push(text(getElementByIdInScope(el, ref)))
  }
  parts.push(el.getAttribute('aria-label') ?? '', el.getAttribute('placeholder') ?? '', el.getAttribute('name') ?? '', el.getAttribute('id') ?? '')
  return parts.filter(Boolean).join(' ').slice(0, 300)
}

const uploaderText = (input: Element): string => {
  let node: Element | null = input.parentElement
  for (let depth = 0; node && depth < 4; depth++) {
    const t = text(node)
    if (t && t.length <= 300) return t
    node = node.parentElement
  }
  return ''
}

const kindOf = (el: Element): Kind | null => {
  const type = (el.getAttribute('type') ?? '').toLowerCase()
  if (type === 'file') return KIND_PATTERNS.find(([k]) => k === 'resume')![1].test(`${labelText(el)} ${uploaderText(el)}`) ? 'resume' : null
  if (type === 'email') return 'email'
  if (type === 'tel') return 'phone'
  const ac = (el.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/).pop() ?? ''
  if (AUTOCOMPLETE_KIND[ac]) return AUTOCOMPLETE_KIND[ac]
  const label = labelText(el)
  for (const [kind, re] of KIND_PATTERNS) {
    if (kind !== 'resume' && re.test(label)) return kind
  }
  return null
}

const isSearchControl = (el: Element): boolean => {
  if ((el.getAttribute('type') ?? '').toLowerCase() === 'search') return true
  if (closestComposed(el, SEARCH_CONTEXT)) return true
  return SEARCH_NAME.test(el.getAttribute('name') ?? '')
}

const commonAncestor = (els: Element[]): Node | null => {
  let node: Node | null = els[0] ? composedParent(els[0]) : null
  while (node && !els.every((el) => composedContains(node!, el))) node = composedParent(node)
  return node
}

const isShell = (node: Node | null): boolean =>
  !node || !(node instanceof Element || node instanceof ShadowRoot) || (node instanceof Element && (node.tagName === 'BODY' || node.tagName === 'HTML'))

const hasApplicationKeywords = (root: Node): boolean => {
  const sample = (root.textContent ?? '').slice(0, 20000).toLowerCase()
  return APPLICATION_KEYWORDS.some((kw) => sample.includes(kw))
}

export type ApplicationEvidence = {
  verdict: AutoModeVerdict
  reason: string
}

export const assessApplicationEvidence = (doc: Document = document): ApplicationEvidence => {
  const controls = querySelectorAllDeep<HTMLElement>(doc, CONTROL_SELECTOR).filter(
    (el) => !el.hasAttribute('disabled') && !isConcealedControl(el) && !isSearchControl(el),
  )
  const files = controls.filter((el) => (el.getAttribute('type') ?? '').toLowerCase() === 'file')
  const visible = controls.filter((el) => (el.getAttribute('type') ?? '').toLowerCase() !== 'file' && isShown(el))
  const hasPassword = visible.some((el) => (el.getAttribute('type') ?? '').toLowerCase() === 'password')

  if (files.some((el) => kindOf(el) === 'resume')) return { reason: 'resume upload', verdict: 'application' }

  const byKind = new Map<Kind, HTMLElement>()
  for (const el of visible) {
    const kind = kindOf(el)
    if (kind && !byKind.has(kind)) byKind.set(kind, el)
  }
  const applicant = Array.from(byKind.values())
  if (byKind.size >= 3 && !hasPassword) {
    const container = commonAncestor(applicant)
    const form = closestComposed(applicant[0], 'form')
    if (!isShell(container) || (form && applicant.every((el) => composedContains(form, el)))) {
      return { reason: `applicant fields: ${Array.from(byKind.keys()).sort().join(',')}`, verdict: 'application' }
    }
  }

  if (!hasPassword && visible.length >= 3) {
    const forms = querySelectorAllDeep(doc, 'form, [role="form"]').filter((form) => visible.filter((el) => composedContains(form, el)).length >= 3)
    if (forms.some((form) => hasApplicationKeywords(form))) return { reason: 'application form', verdict: 'application' }
  }

  return { reason: hasPassword ? 'login or account form' : 'no application evidence', verdict: 'notesOnly' }
}

export const resolveAutoModeFromDom = (): AutoModeVerdict => assessApplicationEvidence(document).verdict

import { isConcealedControl } from '~/core/concealment'
import { querySelectorAllDeep } from '~/core/shadowDom'
import { domClaims, type Claims } from '~/field/claims'
import { isVisible } from '~/field/fieldVisibility'

const SKIP_INPUT_TYPES = new Set([
  'hidden',
  'submit',
  'button',
  'reset',
  'image',
  'file',
  'password',
])

export const TEXT_INPUT_SELECTOR = [
  "input[type='text']",
  "input[type='email']",
  "input[type='tel']",
  "input[type='url']",
  "input[type='number']",
  "input[type='search']",
  'input:not([type])',
].join(', ')

export const COMBOBOX_SELECTOR = '[role="combobox"]'

export const CONTENT_EDITABLE_SELECTOR = '[contenteditable="true"], [contenteditable=""], [role="textbox"]'

export const isCandidateControl = (el: HTMLElement, claims: Claims = domClaims): boolean => {
  if (claims.isInside(el)) return false
  if (claims.isPart(el)) return false
  if (!isVisible(el)) return false
  if (el.hasAttribute('disabled')) return false
  if (el.hasAttribute('readonly')) return false
  if (el.getAttribute('aria-hidden') === 'true') return false
  if (el.getAttribute('aria-disabled') === 'true') return false
  if (el.getAttribute('aria-readonly') === 'true') return false
  if (isConcealedControl(el)) return false

  const tag = el.tagName.toLowerCase()
  if (tag === 'input') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase()
    if (SKIP_INPUT_TYPES.has(type)) return false
  }
  return true
}

export const isSelectOnly = (el: HTMLElement): boolean =>
  el.getAttribute('aria-haspopup') === 'listbox' || el.hasAttribute('aria-controls') || el.hasAttribute('aria-owns')

export const comboboxQualifies = (el: HTMLElement): boolean => {
  if (el.getAttribute('aria-disabled') === 'true') return false
  if (el.hasAttribute('disabled')) return false
  if (el.getAttribute('aria-readonly') === 'true') return false
  if (el.hasAttribute('readonly') && !isSelectOnly(el)) return false
  return true
}

const CONTENT_EDITABLE_EXCLUDED_TAGS = new Set(['INPUT', 'TEXTAREA'])

export const isContentEditableLike = (el: HTMLElement): boolean => {
  if (CONTENT_EDITABLE_EXCLUDED_TAGS.has(el.tagName)) return false
  if (el.isContentEditable) return true
  return el.getAttribute('role') === 'textbox'
}

export const querySelectorAllInNode = (
  node: Node,
  selector: string,
): HTMLElement[] => querySelectorAllDeep<HTMLElement>(node, selector)

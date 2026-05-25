import { isInsideRegistered, isVisible } from '~/field/baseField'
import { PART_MARKER_ATTR } from '~/core/dateUtils'

const SKIP_INPUT_TYPES = new Set([
  'hidden',
  'submit',
  'button',
  'reset',
  'image',
  'file',
  'password',
])

export const isCandidateControl = (el: HTMLElement): boolean => {
  if (isInsideRegistered(el)) return false
  if (el.hasAttribute(PART_MARKER_ATTR)) return false
  if (!isVisible(el)) return false
  if (el.hasAttribute('disabled')) return false
  if (el.hasAttribute('readonly')) return false
  if (el.getAttribute('aria-hidden') === 'true') return false
  if (el.getAttribute('aria-disabled') === 'true') return false

  const tag = el.tagName.toLowerCase()
  if (tag === 'input') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase()
    if (SKIP_INPUT_TYPES.has(type)) return false
  }
  return true
}

export const querySelectorAllInNode = (
  node: Node,
  selector: string,
): HTMLElement[] => {
  if (node === document) {
    return Array.from(document.querySelectorAll<HTMLElement>(selector))
  }
  if (node instanceof Element || node instanceof DocumentFragment) {
    return Array.from(node.querySelectorAll<HTMLElement>(selector))
  }
  if (typeof (node as ShadowRoot).querySelectorAll === 'function') {
    return Array.from(
      (node as ShadowRoot).querySelectorAll<HTMLElement>(selector),
    )
  }
  return []
}
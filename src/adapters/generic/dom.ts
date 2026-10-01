import { isInsideRegistered, isVisible } from '~/field/baseField'
import { PART_MARKER_ATTR } from '~/core/dateUtils'
import { querySelectorAllDeep } from '~/core/shadowDom'
import { isConcealedControl } from '~/core/concealment'

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
  if (el.getAttribute('aria-readonly') === 'true') return false
  if (isConcealedControl(el)) return false

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
): HTMLElement[] => querySelectorAllDeep<HTMLElement>(node, selector)

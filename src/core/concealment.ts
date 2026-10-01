import { composedParent } from './shadowDom'

const CONCEALING_ANCESTOR = '[aria-hidden="true"], [inert], [hidden]'

export const hasConcealingAncestor = (el: Element, includeSelf = true): boolean => {
  let node: Node | null = includeSelf ? el : composedParent(el)
  while (node) {
    if (node instanceof Element && node.matches(CONCEALING_ANCESTOR)) return true
    node = composedParent(node)
  }
  return false
}

export const isOffCanvas = (el: Element): boolean => {
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return false
  const view = el.ownerDocument.defaultView
  const pageBottom = rect.bottom + (view?.scrollY ?? 0)
  if (pageBottom <= 0) return true
  const rtl = view?.getComputedStyle(el.ownerDocument.documentElement).direction === 'rtl'
  return !rtl && rect.right + (view?.scrollX ?? 0) <= 0
}

export const isConcealedControl = (el: Element): boolean =>
  hasConcealingAncestor(el) || isOffCanvas(el)

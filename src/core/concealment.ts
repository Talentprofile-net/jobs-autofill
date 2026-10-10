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

const isOutsidePage = (rect: DOMRect, scrollX: number, scrollY: number, rtl: boolean): boolean =>
  rect.bottom + scrollY <= 0 || (!rtl && rect.right + scrollX <= 0)

const insideOnCanvasAncestor = (el: Element, rect: DOMRect, scrollX: number, scrollY: number, rtl: boolean): boolean => {
  for (let node = composedParent(el); node; node = composedParent(node)) {
    if (!(node instanceof Element)) continue
    const box = node.getBoundingClientRect()
    if ((box.width === 0 && box.height === 0) || isOutsidePage(box, scrollX, scrollY, rtl)) continue
    const top = box.top - (node.scrollTop || 0)
    const left = box.left - (node.scrollLeft || 0)
    const vertical = rect.top >= top && rect.bottom <= top + Math.max(node.scrollHeight || 0, box.height)
    return vertical && (rtl || (rect.left >= left && rect.right <= left + Math.max(node.scrollWidth || 0, box.width)))
  }
  return false
}

export const isOffCanvas = (el: Element): boolean => {
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return false
  const view = el.ownerDocument.defaultView
  const scrollX = view?.scrollX ?? 0
  const scrollY = view?.scrollY ?? 0
  const rtl = view?.getComputedStyle(el.ownerDocument.documentElement).direction === 'rtl'
  return isOutsidePage(rect, scrollX, scrollY, rtl) && !insideOnCanvasAncestor(el, rect, scrollX, scrollY, rtl)
}

export const isConcealedControl = (el: Element): boolean =>
  hasConcealingAncestor(el) || isOffCanvas(el)

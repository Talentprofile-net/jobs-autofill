import { FIELD_MARKER_ATTR } from '~/config'
import { PART_MARKER_ATTR } from '~/core/dateUtils'
import { composedParent } from '~/core/shadowDom'

export type Claims = {
  isMarked: (el: Element) => boolean
  isPart: (el: Element) => boolean
  isInside: (el: Element) => boolean
}

export type MemoryClaims = Claims & {
  mark: (el: Element) => void
  markPart: (el: Element) => void
}

const insideBy =
  (isMarked: (el: Element) => boolean) =>
  (el: Element): boolean => {
    for (let node: Node | null = el; node; node = composedParent(node)) {
      if (node instanceof Element && isMarked(node)) return true
    }
    return false
  }

const markedInDom = (el: Element): boolean => el.hasAttribute(FIELD_MARKER_ATTR)

export const domClaims: Claims = {
  isInside: insideBy(markedInDom),
  isMarked: markedInDom,
  isPart: (el) => el.hasAttribute(PART_MARKER_ATTR),
}

export const createMemoryClaims = (): MemoryClaims => {
  const marked = new WeakSet<Element>()
  const parts = new WeakSet<Element>()
  const isMarked = (el: Element): boolean => marked.has(el)
  return {
    isInside: insideBy(isMarked),
    isMarked,
    isPart: (el) => parts.has(el),
    mark: (el) => void marked.add(el),
    markPart: (el) => void parts.add(el),
  }
}

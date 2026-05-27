import { sleep } from './async'

type Callback<T> = () => T | Promise<T>

export type ScrollBackOptions = {
  delay?: number
  element?: HTMLElement | null
}

const isScrollable = (el: HTMLElement): boolean => {
  const style = window.getComputedStyle(el)
  const overflowY = style.overflowY
  const overflowX = style.overflowX
  const canScrollY =
    (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
    el.scrollHeight > el.clientHeight
  const canScrollX =
    (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay') &&
    el.scrollWidth > el.clientWidth
  return canScrollY || canScrollX
}

const collectScrollableAncestors = (
  start: HTMLElement | null,
): HTMLElement[] => {
  const out: HTMLElement[] = []
  if (!start) return out
  let node: HTMLElement | null = start.parentElement
  let depth = 0
  while (node && node !== document.body && depth < 12) {
    if (isScrollable(node)) out.push(node)
    node = node.parentElement
    depth++
  }
  return out
}

export const scrollBack = async <T>(
  callback: Callback<T>,
  options: ScrollBackOptions = {},
): Promise<T> => {
  const { scrollX, scrollY } = window
  const ancestors = collectScrollableAncestors(options.element ?? null)
  const ancestorSnapshots = ancestors.map((el) => ({
    el,
    top: el.scrollTop,
    left: el.scrollLeft,
  }))
  try {
    const result = callback()
    const value = result instanceof Promise ? await result : result
    if (options.delay && options.delay > 0) {
      await sleep(options.delay)
    }
    return value
  } finally {
    for (const snap of ancestorSnapshots) {
      if (document.documentElement.contains(snap.el)) {
        snap.el.scrollTop = snap.top
        snap.el.scrollLeft = snap.left
      }
    }
    window.scrollTo(scrollX, scrollY)
  }
}
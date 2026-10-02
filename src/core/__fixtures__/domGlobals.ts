import { parseHTML } from 'linkedom'

const GLOBALS = ['document', 'window', 'Element', 'Event', 'HTMLElement', 'HTMLInputElement', 'ShadowRoot', 'MutationObserver', 'Node'] as const

export const installDom = (html: string) => {
  const dom = parseHTML(html)
  const target = globalThis as Record<string, unknown>
  for (const name of GLOBALS) target[name] = name === 'window' ? dom.window : dom[name]
  target.CSS = { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`) }
  return dom
}

export const setRect = (el: Element, rect: { x: number; y: number; width: number; height: number }): void => {
  const box = { ...rect, bottom: rect.y + rect.height, left: rect.x, right: rect.x + rect.width, top: rect.y }
  el.getBoundingClientRect = () => ({ ...box, toJSON: () => box }) as DOMRect
}

export const flushMutations = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const XPATH_AS_CSS: Record<string, string> = {
  ".//form | .//div[@role='form']": 'form, div[role="form"]',
  './/*[@placeholder]': '[placeholder]',
}

export const shimXPath = (): void => {
  Object.assign(globalThis, { XPathResult: { FIRST_ORDERED_NODE_TYPE: 9, ORDERED_NODE_SNAPSHOT_TYPE: 7 } })
  Object.assign(document, {
    evaluate: (xpath: string, context: ParentNode) => {
      const css = XPATH_AS_CSS[xpath]
      if (!css) throw new Error(`unshimmed xpath ${xpath}`)
      const nodes = Array.from(context.querySelectorAll(css))
      return { singleNodeValue: nodes[0] ?? null, snapshotItem: (i: number) => nodes[i] ?? null, snapshotLength: nodes.length }
    },
  })
}

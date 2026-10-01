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

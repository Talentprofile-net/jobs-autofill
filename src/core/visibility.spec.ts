import { describe, expect, it } from 'bun:test'

import { installDom } from '~/core/__fixtures__/domGlobals'
import { whenDocumentVisible } from './visibility'

const fakeDocument = (initial: DocumentVisibilityState) => {
  const handlers = new Set<() => void>()
  let state = initial
  const doc = {
    addEventListener: (_type: 'visibilitychange', fn: () => void) => {
      handlers.add(fn)
    },
    removeEventListener: (_type: 'visibilitychange', fn: () => void) => {
      handlers.delete(fn)
    },
    get visibilityState() {
      return state
    },
  }
  const set = (next: DocumentVisibilityState) => {
    state = next
    for (const fn of Array.from(handlers)) fn()
  }
  return { doc, listeners: () => handlers.size, set }
}

const settled = async (promise: Promise<unknown>) => {
  let done = false
  void promise.then(() => (done = true))
  await new Promise((r) => setTimeout(r, 0))
  return done
}

describe('whenDocumentVisible (auto mode in a background tab)', () => {
  it('resolves at once for a visible document and adds no listener', async () => {
    const { doc, listeners } = fakeDocument('visible')
    expect(await settled(whenDocumentVisible(doc))).toBe(true)
    expect(listeners()).toBe(0)
  })

  it('waits while hidden, ignores hidden-to-hidden changes, and resolves once on becoming visible', async () => {
    const { doc, listeners, set } = fakeDocument('hidden')
    const waiting = whenDocumentVisible(doc)
    expect(await settled(waiting)).toBe(false)
    set('hidden')
    expect(await settled(waiting)).toBe(false)
    expect(listeners()).toBe(1)
    set('visible')
    expect(await settled(waiting)).toBe(true)
    expect(listeners()).toBe(0)
  })
})

describe('whenDocumentVisible shares one waiter per document', () => {
  it('gives concurrent callers one promise and one listener, and starts fresh after the next hide', async () => {
    const { doc, listeners, set } = fakeDocument('hidden')
    const first = whenDocumentVisible(doc)
    const second = whenDocumentVisible(doc)
    expect(second).toBe(first)
    expect(listeners()).toBe(1)
    set('visible')
    expect(await settled(first)).toBe(true)
    expect(listeners()).toBe(0)
    set('hidden')
    const third = whenDocumentVisible(doc)
    expect(third).not.toBe(first)
    expect(listeners()).toBe(1)
    expect(await settled(third)).toBe(false)
    set('visible')
    expect(await settled(third)).toBe(true)
    expect(listeners()).toBe(0)
  })
})

describe('main-world mode request in a hidden tab', () => {
  it('sends no mode.get while hidden and exactly one after the tab becomes visible', async () => {
    const dom = installDom('<html><body></body></html>')
    let state: DocumentVisibilityState = 'hidden'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    Object.defineProperty(dom.window, 'location', { configurable: true, value: { origin: 'https://jobs.example.invalid' } })
    const posted: string[] = []
    Object.assign(dom.window, { postMessage: (data: { payload?: { kind?: string } }) => posted.push(data.payload?.kind ?? '') })
    Object.assign(globalThis, { window: dom.window })
    const { getOriginMode } = await import('~/bridge/mainBridge')
    void getOriginMode()
    await new Promise((r) => setTimeout(r, 0))
    expect(posted.filter((k) => k === 'mode.get')).toHaveLength(0)
    state = 'visible'
    document.dispatchEvent(new dom.Event('visibilitychange'))
    await new Promise((r) => setTimeout(r, 0))
    document.dispatchEvent(new dom.Event('visibilitychange'))
    await new Promise((r) => setTimeout(r, 0))
    expect(posted.filter((k) => k === 'mode.get')).toHaveLength(1)
  })
})

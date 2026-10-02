import { afterEach, describe, expect, it, mock } from 'bun:test'

import { installDom, setRect, shimXPath } from '~/core/__fixtures__/domGlobals'
import { querySelectorAllDeep } from '~/core/shadowDom'
import type { ContentScriptRequest, ResolvedOriginMode } from '~/bridge/types'

type Mounted = { container: HTMLElement; destroyed: boolean }
const mounts: Mounted[] = []

mock.module('~/ui/picker/iconMount', () => ({ mountPickerIcon: () => null }))
mock.module('~/ui/formWidgetMount', () => ({
  mountFormFillButton: ({ container }: { container: HTMLElement }) => {
    const entry: Mounted = { container, destroyed: false }
    mounts.push(entry)
    return { destroy: () => (entry.destroyed = true) }
  },
}))

const { allFields, startObserver } = await import('./registry')
const { assessApplicationEvidence } = await import('~/auth/autoModeHeuristic')
const { createAutoModeWatcher } = await import('~/auth/autoModeWatcher')

const LATE_FORM = `<div id="app-form">
  <div class="entry"><label for="name">Full Name</label><input id="name" type="text"></div>
  <div class="entry"><label for="email">Email</label><input id="email" type="email"></div>
  <div class="entry"><label for="phone">Phone</label><input id="phone" type="tel"></div>
  <div class="entry"><label for="resume">Resume</label><input id="resume" type="file"></div>
</div>`

const layout = () => {
  for (const el of querySelectorAllDeep(document, '*')) setRect(el, { height: 30, width: 300, x: 100, y: 100 })
}

const mountPage = () => {
  const dom = installDom('<html><body><div id="job"><h1>Audit Engineer</h1><p>Job description.</p></div><apply-widget id="host"></apply-widget></body></html>')
  Object.assign(dom.window, {
    clearTimeout,
    getComputedStyle: () => ({ direction: 'ltr', display: 'block', opacity: '1', visibility: 'visible' }),
    scrollX: 0,
    scrollY: 0,
    setTimeout,
  })
  Object.defineProperty(dom.window, 'location', { configurable: true, value: { hostname: 'apply.example.invalid', origin: 'https://apply.example.invalid' } })
  shimXPath()
  layout()
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

const start = () => {
  const handlers: Array<(msg: ContentScriptRequest) => void> = []
  const stop = startObserver({
    getOriginMode: () => Promise.resolve<ResolvedOriginMode>('notesOnly'),
    onBridgeMessage: (handler) => {
      handlers.push(handler)
      return () => handlers.splice(handlers.indexOf(handler), 1)
    },
  })
  const relay = (mode: ResolvedOriginMode) => {
    for (const handler of [...handlers]) handler({ id: crypto.randomUUID(), kind: 'mode.changed', mode })
  }
  return { relay, stop }
}

const fieldIds = () => allFields().map((field) => field.element.id).sort()
const liveWidgets = () => mounts.filter((m) => !m.destroyed)

describe('discovery after an auto-mode upgrade to application', () => {
  let stop: (() => void) | null = null

  afterEach(() => {
    stop?.()
    stop = null
    mounts.length = 0
  })

  it('registers the late shadow-root application and mounts exactly one widget', async () => {
    mountPage()
    const page = start()
    stop = page.stop
    await tick()
    expect(fieldIds()).toEqual([])

    const timers: Array<() => void> = []
    let upgrades = 0
    const observed: { notify: (() => void) | null } = { notify: null }
    const watcher = createAutoModeWatcher({
      clearTimer: () => {},
      debounceMs: 400,
      evaluate: () => assessApplicationEvidence(document).verdict,
      observe: (onChange) => {
        observed.notify = onChange
        return () => (observed.notify = null)
      },
      onUpgrade: () => {
        upgrades++
        page.relay('application')
      },
      setTimer: (fn) => timers.push(fn),
    })
    expect(watcher.verdict()).toBe('notesOnly')

    const root = document.getElementById('host')!.attachShadow({ mode: 'open' })
    root.innerHTML = LATE_FORM
    layout()
    await tick(50)
    expect(fieldIds()).toEqual([])

    observed.notify?.()
    while (timers.length) timers.shift()!()
    expect(watcher.verdict()).toBe('application')
    expect(upgrades).toBe(1)

    expect(fieldIds()).toEqual(['email', 'name', 'phone', 'resume'])
    expect(liveWidgets()).toHaveLength(1)
    expect(liveWidgets()[0].container.getRootNode()).toBe(root)

    page.relay('application')
    page.relay('application')
    await tick(50)
    expect(fieldIds()).toEqual(['email', 'name', 'phone', 'resume'])
    expect(allFields()).toHaveLength(4)
    expect(liveWidgets()).toHaveLength(1)
    expect(mounts).toHaveLength(1)
  })
})

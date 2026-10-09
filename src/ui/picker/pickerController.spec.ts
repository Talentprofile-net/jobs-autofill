import { beforeEach, describe, expect, it, mock } from 'bun:test'

import type { FieldDescriptor } from '~/bridge/types'
import { installDom, setRect } from '~/core/__fixtures__/domGlobals'
import type { ProfileValue } from '~/field/types'
import type { PickerAction } from '~/ui/picker/protocol'
import * as floating from '@floating-ui/dom'
import * as optionLabels from '~/capture/optionLabels'
import * as donorStyle from '~/ui/donorStyle'
import * as insertion from '~/ui/picker/insertion'

const actual = {
  donorStyle: { ...donorStyle },
  floating: { ...floating },
  insertion: { ...insertion },
  optionLabels: { ...optionLabels },
}

type Sent = { kind?: string; hostId?: string; activation?: string; maxHeight?: number }

const sent: Sent[] = []
const inserted: string[] = []
let liveFloating = 0
let mobile = false

mock.module('wxt/browser', () => ({
  browser: {
    runtime: {
      getURL: (path: string) => `chrome-extension://picker-test${path}`,
      sendMessage: (message: Sent) => {
        sent.push(message)
        return Promise.resolve(undefined)
      },
    },
  },
}))
mock.module('@floating-ui/dom', () => ({
  ...actual.floating,
  autoUpdate: () => {
    liveFloating += 1
    return () => {
      liveFloating -= 1
    }
  },
  computePosition: async () => ({ x: 10, y: 20 }),
  flip: () => ({}),
  offset: () => ({}),
  shift: () => ({}),
  size: () => ({}),
}))
mock.module('~/capture/optionLabels', () => ({ ...actual.optionLabels, readOptionLabels: () => null }))
mock.module('~/ui/donorStyle', () => ({
  ...actual.donorStyle,
  findIconDonor: () => null,
  readDonorAppearance: () => null,
}))
mock.module('~/ui/picker/insertion', () => ({
  ...actual.insertion,
  insertIntoField: (_field: HTMLElement, text: string) => {
    inserted.push(text)
    return { inserted: true, maxLength: null, truncated: false }
  },
}))

const { closePicker, handlePickerAction, isPickerOpen, openFillConfirm, openPicker } = await import(
  '~/ui/picker/pickerController'
)

let created: Element[] = []
let listeners = 0
const fills: string[] = []
const fillField = (fieldUuid: string, _value: ProfileValue) => {
  fills.push(fieldUuid)
}

const descriptor = (fieldUuid: string): FieldDescriptor => ({
  fieldName: fieldUuid,
  fieldType: 'TextInput',
  fieldUuid,
  pickerMode: 'full',
  section: 'personal',
})

const fieldTarget = (id: string) => {
  const field = document.getElementById(id)
  if (!(field instanceof HTMLElement)) throw new Error(`missing ${id}`)
  setRect(field, { height: 30, width: 360, x: 10, y: 10 })
  return { anchor: field, descriptor: descriptor(`uuid-${id}`), field, trigger: null }
}

const frames = () => created.filter((el) => el.tagName === 'IFRAME')
const backdrops = () => created.filter((el) => el.tagName === 'DIV' && el.getAttribute('class') === 'backdrop')
const frame = () => {
  const [only] = frames()
  if (!(only instanceof HTMLElement)) throw new Error('no picker frame')
  return only
}
const hostId = () => frame().getAttribute('src')?.split('#')[1] ?? ''
const hosts = () => [...document.documentElement.children].filter((el) => el.tagName === 'DIV')
const display = (el: Element | undefined) => (el instanceof HTMLElement ? el.style.display : null)
const isOpenHost = (el: Element | undefined) => el?.getAttribute('data-tp-open') === 'true'
const interaction = () => {
  const host = hosts()[0]
  const el = frame()
  return {
    ariaHidden: el.getAttribute('aria-hidden'),
    hostInert: host instanceof HTMLElement ? host.inert : null,
    inert: el.inert,
    pointer: el.style.pointerEvents,
    ready: el.getAttribute('data-tp-ready'),
  }
}
const DISABLED = { ariaHidden: 'true', hostInert: true, inert: true, pointer: 'none', ready: null }
const ENABLED = { ariaHidden: null, hostInert: false, inert: false, pointer: '', ready: 'true' }
const signals = (kind: string) => sent.filter((message) => message.kind === kind)
const lastActivation = () => signals('picker.activate').at(-1)?.activation ?? null
const relay = (activation: string | null, action: Parameters<typeof handlePickerAction>[2]) =>
  handlePickerAction(hostId(), activation, action, fillField)
const ready = () => relay(null, { type: 'ready' })
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const fieldUuidOf = (activation: string | null) => {
  const response = relay(activation, { type: 'context' })
  if (!isRecord(response) || !isRecord(response.data) || !isRecord(response.data.descriptor)) return null
  const id = response.data.descriptor.fieldUuid
  return typeof id === 'string' ? id : null
}
const contextOf = (activation: string | null) => {
  const response = relay(activation, { type: 'context' })
  return isRecord(response) && isRecord(response.data) ? response.data : null
}
const userEvent = (type: string, trusted: boolean) => {
  const event = new window.Event(type, { bubbles: true })
  Object.defineProperty(event, 'isTrusted', { value: trusted })
  return event
}
const press = (key: string, trusted = true, target: Element = document.body) => {
  const event = userEvent('keydown', trusted)
  Object.defineProperty(event, 'key', { value: key })
  target.dispatchEvent(event)
}
const mouseDownOn = (el: Element, trusted = true) => el.dispatchEvent(userEvent('mousedown', trusted))

beforeEach(() => {
  closePicker()
  installDom(`<html><body>
    <input id="first"><input id="second"><button id="elsewhere">x</button>
  </body></html>`)
  Object.assign(window, {
    getComputedStyle: () => ({ direction: 'ltr', display: 'block', position: 'static', visibility: 'visible' }),
    innerHeight: 800,
    matchMedia: () => ({ matches: mobile }),
    scrollX: 0,
    scrollY: 0,
  })
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL('https://job-boards.greenhouse.io/smoke/jobs/1'),
  })
  created = []
  listeners = 0
  const createElement = document.createElement.bind(document)
  const addEventListener = document.addEventListener.bind(document)
  const removeEventListener = document.removeEventListener.bind(document)
  Object.assign(document, {
    addEventListener: (...args: Parameters<Document['addEventListener']>) => {
      if (args[0] === 'mousedown' || args[0] === 'keydown') listeners += 1
      return addEventListener(...args)
    },
    createElement: (tag: string) => {
      const el = createElement(tag)
      created.push(el)
      return el
    },
    removeEventListener: (...args: Parameters<Document['removeEventListener']>) => {
      if (args[0] === 'mousedown' || args[0] === 'keydown') listeners -= 1
      return removeEventListener(...args)
    },
  })
  sent.length = 0
  inserted.length = 0
  fills.length = 0
  liveFloating = 0
  mobile = false
})

describe('persistent picker frame', () => {
  it('reuses one iframe across 100 open and close cycles without accumulating observers or listeners', () => {
    openPicker(fieldTarget('first'))
    ready()
    closePicker()
    for (let cycle = 0; cycle < 100; cycle += 1) {
      openPicker(fieldTarget(cycle % 2 ? 'first' : 'second'))
      expect(isPickerOpen()).toBe(true)
      expect(liveFloating).toBe(1)
      expect(listeners).toBe(2)
      closePicker()
      expect(liveFloating).toBe(0)
      expect(listeners).toBe(0)
    }
    expect(frames()).toHaveLength(1)
    expect(hosts()).toHaveLength(1)
    expect(frame().isConnected).toBe(true)
    expect(signals('picker.activate')).toHaveLength(101)
    expect(signals('picker.deactivate')).toHaveLength(101)
  })

  it('presents the new field context on reopen and refuses the previous activation', () => {
    openPicker(fieldTarget('first'))
    ready()
    const first = lastActivation()
    expect(fieldUuidOf(first)).toBe('uuid-first')
    closePicker()
    openPicker(fieldTarget('second'))
    const second = lastActivation()
    expect(second).not.toBe(first)
    expect(fieldUuidOf(second)).toBe('uuid-second')
    expect(fieldUuidOf(first)).toBeNull()
  })

  it('never lets a previous activation insert, fill, confirm, resize or dismiss the current one', () => {
    openPicker(fieldTarget('first'))
    ready()
    const stale = lastActivation()
    openPicker(fieldTarget('second'))
    const current = lastActivation()
    const actions: PickerAction[] = [
      { text: 'leak', type: 'insert' },
      { type: 'fill', value: { confidence: 'exact', kind: 'string', value: 'leak' } },
      { type: 'confirmFill' },
      { height: 200, type: 'resize' },
      { type: 'dismiss' },
    ]
    for (const action of actions) {
      expect(relay(stale, action)).toBeNull()
    }
    expect(isPickerOpen()).toBe(true)
    expect(inserted).toEqual([])
    expect(fills).toEqual([])
    expect(frame().style.height).toBe('0px')
    expect(frame().getAttribute('data-tp-ready')).toBeNull()
    expect(fieldUuidOf(current)).toBe('uuid-second')
  })

  it('stays closed when the frame becomes ready after an early close', () => {
    openPicker(fieldTarget('first'))
    closePicker()
    expect(signals('picker.activate')).toHaveLength(0)
    expect(ready()).toEqual({ ok: true })
    expect(signals('picker.activate')).toHaveLength(0)
    expect(isPickerOpen()).toBe(false)
    expect(isOpenHost(hosts()[0])).toBe(false)
    expect(frame().style.height).toBe('0px')
  })

  it('shows one picker for the last target after a rapid open, close and open', () => {
    openPicker(fieldTarget('first'))
    closePicker()
    openPicker(fieldTarget('second'))
    ready()
    expect(signals('picker.activate')).toHaveLength(1)
    expect(fieldUuidOf(lastActivation())).toBe('uuid-second')
    expect(frames()).toHaveLength(1)
    expect(hosts()).toHaveLength(1)
    expect(isOpenHost(hosts()[0])).toBe(true)
  })

  it('deactivates on an outside click and on Escape without removing the iframe', () => {
    openPicker(fieldTarget('first'))
    ready()
    const elsewhere = document.getElementById('elsewhere')
    if (!elsewhere) throw new Error('missing button')
    mouseDownOn(elsewhere)
    expect(isPickerOpen()).toBe(false)
    expect(frame().isConnected).toBe(true)
    openPicker(fieldTarget('first'))
    mouseDownOn(document.getElementById('first') ?? elsewhere)
    expect(isPickerOpen()).toBe(true)
    press('Escape')
    expect(isPickerOpen()).toBe(false)
    expect(frame().isConnected).toBe(true)
    expect(frames()).toHaveLength(1)
    expect(signals('picker.deactivate')).toHaveLength(2)
  })

  it('stays open when a page or another field dispatches a synthetic Escape or mousedown', () => {
    openPicker(fieldTarget('first'))
    ready()
    const elsewhere = document.getElementById('elsewhere')
    if (!elsewhere) throw new Error('missing button')
    press('Escape', false, elsewhere)
    press('Escape', false)
    mouseDownOn(elsewhere, false)
    expect(isPickerOpen()).toBe(true)
    expect(signals('picker.deactivate')).toHaveLength(0)
    press('Escape')
    expect(isPickerOpen()).toBe(false)
    expect(signals('picker.deactivate')).toHaveLength(1)
  })

  it('runs the fill confirmation and its dismissal at most once', () => {
    let confirmed = 0
    let dismissed = 0
    const anchor = fieldTarget('first').anchor
    openFillConfirm({ anchor, onConfirm: () => (confirmed += 1), onDismiss: () => (dismissed += 1) })
    ready()
    const activation = lastActivation()
    expect(relay(activation, { type: 'confirmFill' })).toEqual({ ok: true })
    expect(relay(activation, { type: 'confirmFill' })).toBeNull()
    expect(relay(activation, { type: 'dismiss' })).toBeNull()
    expect([confirmed, dismissed]).toEqual([1, 0])

    openFillConfirm({ anchor, onConfirm: () => (confirmed += 1), onDismiss: () => (dismissed += 1) })
    const second = lastActivation()
    expect(relay(second, { type: 'dismiss' })).toEqual({ ok: true })
    expect(relay(second, { type: 'confirmFill' })).toBeNull()
    closePicker()
    expect([confirmed, dismissed]).toEqual([1, 1])
  })

  it('keeps one mobile backdrop and shows it only after the activation has sized itself', () => {
    mobile = true
    openPicker(fieldTarget('first'))
    ready()
    for (let cycle = 0; cycle < 20; cycle += 1) {
      closePicker()
      openPicker(fieldTarget('second'))
    }
    expect(backdrops()).toHaveLength(1)
    expect(display(backdrops()[0])).toBe('none')
    expect(relay(lastActivation(), { height: 200, type: 'resize' })).toEqual({ ok: true })
    expect(display(backdrops()[0])).toBe('')
    expect(liveFloating).toBe(0)
    closePicker()
    expect(display(backdrops()[0])).toBe('none')
  })

  it('parks a closed frame hidden, inert and pointer-disabled at zero height', () => {
    openPicker(fieldTarget('first'))
    ready()
    expect(relay(lastActivation(), { height: 200, type: 'resize' })).toEqual({ ok: true })
    expect(frame().style.height).toBe('200px')
    expect(interaction()).toEqual(ENABLED)
    closePicker()
    expect(frame().style.height).toBe('0px')
    expect([frame().style.left, frame().style.top]).toEqual(['-10000px', '-10000px'])
    expect(interaction()).toEqual(DISABLED)
    expect(frame().isConnected).toBe(true)
  })

  it('keeps a new activation disabled until its own first resize', () => {
    openPicker(fieldTarget('first'))
    ready()
    relay(lastActivation(), { height: 200, type: 'resize' })
    closePicker()
    openPicker(fieldTarget('second'))
    expect(interaction()).toEqual(DISABLED)
    expect(relay(lastActivation(), { height: 0, type: 'resize' })).toEqual({ ok: true })
    expect(interaction()).toEqual(DISABLED)
    expect(relay(lastActivation(), { height: 180, type: 'resize' })).toEqual({ ok: true })
    expect(interaction()).toEqual(ENABLED)
  })

  it('never lets a stale resize reveal or enable the frame', () => {
    openPicker(fieldTarget('first'))
    ready()
    const stale = lastActivation()
    openPicker(fieldTarget('second'))
    expect(relay(stale, { height: 200, type: 'resize' })).toBeNull()
    expect(frame().style.height).toBe('0px')
    expect(interaction()).toEqual(DISABLED)
    closePicker()
    expect(relay(lastActivation(), { height: 200, type: 'resize' })).toBeNull()
    expect(interaction()).toEqual(DISABLED)
  })

  it('disables the frame before clearing the activation or restoring focus', () => {
    const target = fieldTarget('first')
    const seen: unknown[] = []
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => target.field })
    Object.assign(target.field, { focus: () => seen.push({ ...interaction(), open: isPickerOpen() }) })
    openPicker(target)
    ready()
    relay(lastActivation(), { height: 200, type: 'resize' })
    closePicker()
    expect(seen).toEqual([{ ...DISABLED, open: false }])
  })

  it('titles the frame for the field picker and the fill confirmation', () => {
    openPicker(fieldTarget('first'))
    expect(frame().getAttribute('title')).toBe('Insert from TalentProfile')
    openFillConfirm({ anchor: fieldTarget('second').anchor, onConfirm: () => {}, onDismiss: () => {} })
    expect(frame().getAttribute('title')).toBe('Fill this form with TalentProfile')
    openPicker(fieldTarget('second'))
    expect(frame().getAttribute('title')).toBe('Insert from TalentProfile')
  })

  it('ignores actions addressed to another frame picker', () => {
    openPicker(fieldTarget('first'))
    ready()
    const activation = lastActivation()
    expect(handlePickerAction('another-frame', activation, { type: 'dismiss' }, fillField)).toBeNull()
    expect(handlePickerAction('another-frame', null, { type: 'ready' }, fillField)).toBeNull()
    expect(isPickerOpen()).toBe(true)
  })

  it('carries the standard field of each reopened field through the reused frame and fills nothing by itself', () => {
    document.getElementById('first')?.setAttribute('autocomplete', 'given-name')
    document.getElementById('second')?.setAttribute('name', 'email')
    openPicker(fieldTarget('first'))
    ready()
    const first = lastActivation()
    expect(contextOf(first)?.standardField).toBe('given-name')
    closePicker()
    openPicker(fieldTarget('second'))
    const second = lastActivation()
    expect(frames()).toHaveLength(1)
    expect(contextOf(second)?.standardField).toBe('email')
    expect(contextOf(first)).toBeNull()
    expect(inserted).toEqual([])
    expect(fills).toEqual([])
  })

  it('sends no standard field for a field without standard evidence', () => {
    openPicker(fieldTarget('first'))
    ready()
    expect(contextOf(lastActivation())?.standardField).toBeNull()
  })

  it('never inserts or fills without a user action from the picker', () => {
    openPicker(fieldTarget('first'))
    ready()
    expect(fieldUuidOf(lastActivation())).toBe('uuid-first')
    closePicker()
    openFillConfirm({
      anchor: fieldTarget('second').anchor,
      onConfirm: () => fills.push('confirm'),
      onDismiss: () => {},
    })
    expect(inserted).toEqual([])
    expect(fills).toEqual([])
  })
})

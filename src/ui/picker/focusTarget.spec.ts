import { beforeEach, describe, expect, it } from 'bun:test'

import { installDom } from '~/core/__fixtures__/domGlobals'
import { focusedFieldTarget } from './focusTarget'

let focused = true

beforeEach(() => {
  installDom(`<html><body>
    <input id="first" data-tp-field="uuid-first">
    <input id="plain">
    <spl-input id="host" data-tp-field="uuid-host"></spl-input>
  </body></html>`)
  focused = true
  Object.assign(document, { hasFocus: () => focused })
})

const focus = (el: Element | null) =>
  Object.defineProperty(document, 'activeElement', { configurable: true, get: () => el })

describe('focusedFieldTarget (picker command in one frame of many)', () => {
  it('opens for the focused registered field of the focused frame', () => {
    const first = document.getElementById('first')!
    focus(first)
    expect(focusedFieldTarget(document)).toEqual({ fieldUuid: 'uuid-first', focused: first })
  })

  it('ignores a frame that does not have focus, even when its last focused field is still active', () => {
    focus(document.getElementById('first'))
    focused = false
    expect(focusedFieldTarget(document)).toBeNull()
  })

  it('ignores a focused element that is not a registered field', () => {
    focus(document.getElementById('plain'))
    expect(focusedFieldTarget(document)).toBeNull()
    focus(document.body)
    expect(focusedFieldTarget(document)).toBeNull()
  })

  it('reaches a focused control inside an open shadow root', () => {
    const host = document.getElementById('host')!
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = '<input id="inner">'
    const inner = root.querySelector('input')!
    focus(host)
    Object.defineProperty(root, 'activeElement', { configurable: true, get: () => inner })
    expect(focusedFieldTarget(document)).toEqual({ fieldUuid: 'uuid-host', focused: inner })
  })
})

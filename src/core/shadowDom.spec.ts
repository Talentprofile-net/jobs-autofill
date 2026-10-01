import { beforeEach, describe, expect, it } from 'bun:test'

import { flushMutations, installDom } from './__fixtures__/domGlobals'
import {
  closestComposed,
  composedContains,
  deepActiveElement,
  createShadowRootObserver,
  getElementByIdInScope,
  openShadowRoots,
  querySelectorAllDeep,
  querySelectorDeep,
} from './shadowDom'
import { resolveFieldLabel } from '~/adapters/generic/labelResolver'

const PAGE = `<html><body>
<input id="outside" name="search">
<form id="application">
  <spl-form-field id="ff-first"><spl-input id="first" label="First name"></spl-input></spl-form-field>
  <spl-form-field id="ff-email"><spl-input id="email" label="Email"></spl-input></spl-form-field>
  <spl-phone-field id="phone"></spl-phone-field>
  <input id="light-city" name="city">
  <div id="closed-host"></div>
</form>
</body></html>`

const attachInput = (host: Element, id: string, type = 'text', extra = ''): ShadowRoot => {
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `<div class="wrap"><input id="${id}" type="${type}" ${extra}></div>`
  return root
}

const build = () => {
  installDom(PAGE)
  for (const id of ['ff-first', 'ff-email']) {
    const root = document.getElementById(id)!.attachShadow({ mode: 'open' })
    root.innerHTML = '<div class="field"><slot></slot></div>'
  }
  attachInput(document.getElementById('first')!, 'first-name-input')
  attachInput(document.getElementById('email')!, 'email-input', 'email')
  const phoneRoot = document.getElementById('phone')!.attachShadow({ mode: 'open' })
  phoneRoot.innerHTML = '<spl-dropdown-search id="dial"></spl-dropdown-search><spl-input id="tel"></spl-input>'
  attachInput(phoneRoot.querySelector('#dial')!, 'dial-search', 'text', 'placeholder="Search by country/region or code"')
  attachInput(phoneRoot.querySelector('#tel')!, 'phone-input', 'tel', 'aria-label="Phone number"')
  const closed = document.getElementById('closed-host')!.attachShadow({ mode: 'closed' })
  closed.innerHTML = '<input id="closed-input">'
}

const ids = (els: Element[]) => els.map((el) => el.id)

describe('open shadow root traversal (SmartRecruiters spl-input shape)', () => {
  beforeEach(build)

  it('finds every open root, including roots nested inside other shadow roots', () => {
    const hosts = openShadowRoots(document).map((root) => root.host.id)
    expect(hosts.sort()).toEqual(['dial', 'email', 'ff-email', 'ff-first', 'first', 'phone', 'tel'])
  })

  it('returns light and shadow controls, and never enters a closed root', () => {
    const found = ids(querySelectorAllDeep(document, 'input'))
    expect(found.sort()).toEqual(
      ['dial-search', 'email-input', 'first-name-input', 'light-city', 'outside', 'phone-input'].sort(),
    )
    expect(found).not.toContain('closed-input')
  })

  it('a plain querySelectorAll sees none of the shadow controls', () => {
    expect(ids(Array.from(document.querySelectorAll('input'))).sort()).toEqual(['light-city', 'outside'])
  })

  it('stays inside the container it is given', () => {
    const found = ids(querySelectorAllDeep(document.getElementById('application')!, 'input'))
    expect(found).not.toContain('outside')
    expect(found).toContain('phone-input')
  })

  it('finds a field marker inside a shadow root', () => {
    const tel = querySelectorDeep(document, '#phone-input')!
    tel.setAttribute('data-tp-field', 'uuid-tel')
    expect(querySelectorDeep(document, '[data-tp-field="uuid-tel"]')).toBe(tel)
  })

  it('treats a nested shadow control as inside its light-DOM form', () => {
    const tel = querySelectorDeep(document, '#phone-input')!
    expect(document.getElementById('application')!.contains(tel)).toBe(false)
    expect(composedContains(document.getElementById('application')!, tel)).toBe(true)
    expect(composedContains(document.getElementById('outside')!, tel)).toBe(false)
  })

  it('resolves ids inside the control shadow root before the document', () => {
    const root = document.getElementById('email')!.shadowRoot!
    root.innerHTML += '<span id="hint">Work email</span>'
    const input = root.querySelector('input')!
    expect(getElementByIdInScope(input, 'hint')?.textContent).toBe('Work email')
    expect(getElementByIdInScope(input, 'light-city')?.id).toBe('light-city')
  })
})

describe('labels for shadow controls', () => {
  beforeEach(build)

  it('uses the host label attribute when the shadow root has no label', () => {
    expect(resolveFieldLabel(querySelectorDeep(document, '#first-name-input')!)).toBe('First name')
  })

  it('prefers the control aria-label over the host label', () => {
    expect(resolveFieldLabel(querySelectorDeep(document, '#phone-input')!)).toBe('Phone number')
  })

  it('finds a label[for] that lives in the same shadow root', () => {
    const root = document.getElementById('email')!.shadowRoot!
    const label = document.createElement('label')
    label.setAttribute('for', 'email-input')
    label.textContent = 'Email address'
    root.prepend(label)
    expect(resolveFieldLabel(root.querySelector('input')!)).toBe('Email address')
  })
})

describe('shadow root observer', () => {
  beforeEach(build)

  it('observes every open root once and reports mutations inside them', async () => {
    let calls = 0
    const observer = createShadowRootObserver(() => {
      calls += 1
    }, { childList: true, subtree: true })
    observer.sync(document)
    observer.sync(document)
    expect(observer.observedCount()).toBe(7)
    querySelectorDeep(document, '#tel')!.shadowRoot!.appendChild(document.createElement('input'))
    await flushMutations()
    expect(calls).toBe(1)
    observer.disconnect()
  })

  it('picks up a root attached after the first sync on the next sync', async () => {
    let calls = 0
    const observer = createShadowRootObserver(() => {
      calls += 1
    }, { childList: true, subtree: true })
    observer.sync(document)
    const late = document.createElement('spl-input')
    document.getElementById('application')!.appendChild(late)
    const lateRoot = attachInput(late, 'late-input')
    observer.sync(document)
    expect(observer.observedCount()).toBe(8)
    lateRoot.appendChild(document.createElement('span'))
    await flushMutations()
    expect(calls).toBe(1)
    observer.disconnect()
  })

  it('drops roots whose host left the document and stops after disconnect', async () => {
    let calls = 0
    const observer = createShadowRootObserver(() => {
      calls += 1
    }, { childList: true, subtree: true })
    observer.sync(document)
    const phone = document.getElementById('phone')!
    const phoneRoot = phone.shadowRoot!
    phone.remove()
    observer.sync(document)
    expect(observer.observedCount()).toBe(4)
    phoneRoot.appendChild(document.createElement('span'))
    observer.disconnect()
    expect(observer.observedCount()).toBe(0)
    document.getElementById('first')!.shadowRoot!.appendChild(document.createElement('span'))
    await flushMutations()
    expect(calls).toBe(0)
  })
})

describe('focus inside shadow roots (picker command)', () => {
  beforeEach(build)

  it('follows activeElement through nested open roots to the focused control', () => {
    const phone = document.getElementById('phone')!
    const tel = phone.shadowRoot!.querySelector('#tel')!
    const input = tel.shadowRoot!.querySelector('input')!
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => phone })
    Object.defineProperty(phone.shadowRoot!, 'activeElement', { configurable: true, get: () => tel })
    Object.defineProperty(tel.shadowRoot!, 'activeElement', { configurable: true, get: () => input })
    expect(deepActiveElement(document)).toBe(input)
  })

  it('stops at a host whose shadow root has no focused element', () => {
    const first = document.getElementById('first')!
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => first })
    Object.defineProperty(first.shadowRoot!, 'activeElement', { configurable: true, get: () => null })
    expect(deepActiveElement(document)).toBe(first)
  })

  it('finds the field marker on a shadow control or on its light-DOM host', () => {
    const input = querySelectorDeep(document, '#phone-input')!
    expect(closestComposed(input, '[data-tp-field]')).toBeNull()
    document.getElementById('phone')!.setAttribute('data-tp-field', 'uuid-phone')
    expect(closestComposed(input, '[data-tp-field]')?.id).toBe('phone')
    input.setAttribute('data-tp-field', 'uuid-input')
    expect(closestComposed(input, '[data-tp-field]')).toBe(input)
  })
})

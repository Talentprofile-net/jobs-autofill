import { beforeEach, describe, expect, it } from 'bun:test'

import { installDom, setRect } from './__fixtures__/domGlobals'
import { hasConcealingAncestor, isConcealedControl, isOffCanvas } from './concealment'

const BAMBOO_PAGE = `<html><body>
<form id="application">
  <div style="position:relative">
    <div aria-hidden="true" style="position:absolute;left:-9999px;height:0">
      <div><label for="nickname">Please leave this field blank</label><input id="nickname" name="nickname_hpcsaf" tabindex="-1"></div>
    </div>
    <label for="firstName">First Name *</label><input id="firstName" name="firstName">
    <label for="desiredPay">Desired Pay *</label><input id="desiredPay" name="desiredPay">
  </div>
  <div inert><input id="inert-input"></div>
  <div hidden><input id="hidden-input"></div>
  <section id="modal-host"></section>
</form>
</body></html>`

let direction = 'ltr'

const setup = () => {
  const dom = installDom(BAMBOO_PAGE)
  direction = 'ltr'
  Object.assign(dom.window, { getComputedStyle: () => ({ direction }), scrollX: 0, scrollY: 0 })
  setRect(document.getElementById('nickname')!, { height: 28, width: 179, x: -9935, y: -9735 })
  setRect(document.getElementById('firstName')!, { height: 40, width: 360, x: 996, y: 260 })
  setRect(document.getElementById('desiredPay')!, { height: 40, width: 360, x: 996, y: 2600 })
  return dom
}

describe('BambooHR honeypot', () => {
  beforeEach(() => {
    setup()
  })

  it('rejects the captured off-canvas honeypot', () => {
    const honeypot = document.getElementById('nickname')!
    expect(hasConcealingAncestor(honeypot)).toBe(true)
    expect(isOffCanvas(honeypot)).toBe(true)
    expect(isConcealedControl(honeypot)).toBe(true)
  })

  it('rejects the same far-left field even without aria-hidden', () => {
    const honeypot = document.getElementById('nickname')!
    honeypot.closest('[aria-hidden]')!.removeAttribute('aria-hidden')
    expect(hasConcealingAncestor(honeypot)).toBe(false)
    expect(isConcealedControl(honeypot)).toBe(true)
  })

  it('keeps a real field in view', () => {
    expect(isConcealedControl(document.getElementById('firstName')!)).toBe(false)
  })

  it('keeps a real field below the viewport', () => {
    expect(isConcealedControl(document.getElementById('desiredPay')!)).toBe(false)
  })

  it('keeps a field scrolled above the viewport that the page can scroll back to', () => {
    Object.assign(window, { scrollY: 3000 })
    setRect(document.getElementById('firstName')!, { height: 40, width: 360, x: 996, y: -2740 })
    expect(isOffCanvas(document.getElementById('firstName')!)).toBe(false)
  })

  it('does not treat far-left content on a right-to-left page as a honeypot', () => {
    direction = 'rtl'
    const honeypot = document.getElementById('nickname')!
    setRect(honeypot, { height: 28, width: 179, x: -500, y: 300 })
    expect(isOffCanvas(honeypot)).toBe(false)
  })

  it('does not decide on a control with no layout box', () => {
    const field = document.getElementById('firstName')!
    setRect(field, { height: 0, width: 0, x: -9999, y: 0 })
    expect(isOffCanvas(field)).toBe(false)
  })
})

describe('hidden ancestry', () => {
  beforeEach(() => {
    setup()
  })

  it('rejects controls under inert and hidden ancestors', () => {
    expect(hasConcealingAncestor(document.getElementById('inert-input')!)).toBe(true)
    expect(hasConcealingAncestor(document.getElementById('hidden-input')!)).toBe(true)
  })

  it('follows aria-hidden across a shadow boundary', () => {
    const host = document.getElementById('modal-host')!
    host.setAttribute('aria-hidden', 'true')
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = '<div><input id="in-shadow"></div>'
    expect(hasConcealingAncestor(root.querySelector('input')!)).toBe(true)
  })

  it('ignores aria-hidden="false"', () => {
    const field = document.getElementById('firstName')!
    field.parentElement!.setAttribute('aria-hidden', 'false')
    expect(hasConcealingAncestor(field)).toBe(false)
  })
})

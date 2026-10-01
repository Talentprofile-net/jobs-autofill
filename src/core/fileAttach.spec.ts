import { beforeEach, describe, expect, it } from 'bun:test'

import { installDom, setRect } from './__fixtures__/domGlobals'
import { hasDisplayedAncestor } from './fileAttach'

const PAGE = `<html><body>
<form>
  <label id="lever-label" class="application-label">Resume/CV
    <a class="postings-btn"><span>ATTACH RESUME/CV</span><input id="resume" type="file" name="resume"></a>
  </label>
  <div id="step-2"><div><div><div><div><input id="later-step" type="file"></div></div></div></div></div>
  <div inert><label id="inert-label">CV <input id="inert-file" type="file"></label></div>
  <div aria-hidden="true"><label id="aria-label">Resume <input id="aria-file" type="file"></label></div>
  <div hidden><label id="hidden-label">Resume <input id="hidden-file" type="file"></label></div>
  <div style="position:absolute;left:-9999px"><label id="far-label">Resume <input id="far-file" type="file"></label></div>
  <label id="own-hidden-label">Resume <input id="own-hidden" type="file" hidden></label>
  <section id="modal-host"></section>
</form>
</body></html>`

const ZERO = { height: 0, width: 0, x: 0, y: 0 }

beforeEach(() => {
  const dom = installDom(PAGE)
  Object.assign(dom.window, { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) })
  for (const el of Array.from(document.querySelectorAll('*'))) setRect(el, ZERO)
  setRect(document.getElementById('lever-label')!, { height: 80, width: 460, x: 100, y: 200 })
  for (const id of ['inert-label', 'aria-label', 'hidden-label', 'own-hidden-label'])
    setRect(document.getElementById(id)!, { height: 40, width: 460, x: 100, y: 400 })
  setRect(document.getElementById('far-label')!, { height: 40, width: 460, x: -9935, y: 400 })
})

describe('hasDisplayedAncestor for styled file inputs', () => {
  it('accepts a zero-size file input whose button or label is on screen', () => {
    expect(hasDisplayedAncestor(document.getElementById('resume')!)).toBe(true)
  })

  it('rejects a file input in a section with no displayed box nearby', () => {
    expect(hasDisplayedAncestor(document.getElementById('later-step')!)).toBe(false)
  })

  it('rejects a file input under an inert ancestor', () => {
    expect(hasDisplayedAncestor(document.getElementById('inert-file')!)).toBe(false)
  })

  it('rejects resume honeypots under aria-hidden or hidden ancestors', () => {
    expect(hasDisplayedAncestor(document.getElementById('aria-file')!)).toBe(false)
    expect(hasDisplayedAncestor(document.getElementById('hidden-file')!)).toBe(false)
  })

  it('rejects a resume input whose only displayed box is off canvas', () => {
    expect(hasDisplayedAncestor(document.getElementById('far-file')!)).toBe(false)
  })

  it('still accepts a styled uploader that hides only the native input', () => {
    expect(hasDisplayedAncestor(document.getElementById('own-hidden')!)).toBe(true)
  })

  it('follows inert across a shadow boundary', () => {
    const host = document.getElementById('modal-host')!
    host.setAttribute('inert', '')
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = '<label>Resume <input type="file"></label>'
    const label = root.querySelector('label')!
    setRect(label, { height: 40, width: 460, x: 100, y: 500 })
    expect(hasDisplayedAncestor(root.querySelector('input')!)).toBe(false)
  })
})

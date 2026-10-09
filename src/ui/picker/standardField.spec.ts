import { beforeEach, describe, expect, it } from 'bun:test'

import { installDom, setRect } from '~/core/__fixtures__/domGlobals'
import { readStandardField } from './standardField'

const shown = (el: Element | null): HTMLElement => {
  if (!(el instanceof HTMLElement)) throw new Error('missing element')
  setRect(el, { height: 30, width: 300, x: 10, y: 10 })
  return el
}

const realm = (html: string) => {
  const dom = installDom(html)
  Object.assign(dom.window, {
    getComputedStyle: () => ({ direction: 'ltr', display: 'block', position: 'static', visibility: 'visible' }),
    scrollX: 0,
    scrollY: 0,
  })
}

const byId = (id: string): HTMLElement => shown(document.getElementById(id))

const read = (id: string, fieldName = '', options: string[] | null = null, section = '') =>
  readStandardField(byId(id), { fieldName, section }, options)

beforeEach(() => {
  realm(`<html><body><form>
    <div id="wrap-first" class="field"><label for="first">Vorname</label><input id="first" type="text" autocomplete="given-name"></div>
    <div id="wrap-email"><label>E-Mail <input id="email" type="email" name="job_application[email]"></label></div>
    <input id="aria" aria-labelledby="aria-label" autocomplete="family-name"><span id="aria-label">Last name</span>
    <input id="aria-conflict" aria-labelledby="aria-other" autocomplete="family-name"><span id="aria-other">First name</span>
    <input id="aria-sensitive" aria-label="Emergency contact email" type="email" name="email">
    <fieldset id="eeo"><legend>Voluntary self-identification</legend><input id="eeo-country" autocomplete="country"></fieldset>
    <fieldset id="ok-legend"><legend>Phone</legend><input id="legend-tel" type="tel" name="phone"></fieldset>
    <input id="ambiguous" name="name" autocomplete="on">
    <input id="hidden" name="email" hidden>
    <div aria-hidden="true"><input id="concealed" name="email"></div>
    <input id="disabled" name="email" disabled>
    <input id="readonly" name="email" readonly>
    <input id="aria-disabled" name="email" aria-disabled="true">
    <div id="two"><input name="first_name"><input name="last_name"></div>
    <div id="combo"><input id="combo-input" name="city"><input type="hidden" name="city_id"></div>
    <select id="country" autocomplete="country"><option>Select...</option><option>Germany</option><option>France</option><option>Spain</option></select>
    <textarea id="notes" name="email"></textarea>
    <div id="cv-field"><button type="button">Upload résumé/CV</button><input id="cv" type="file" name="resume"></div>
    <input id="org-title" autocomplete="organization-title">
    <div id="wrap-local"><label for="name--legalName--firstNameLocal">Thai Given Name</label><input type="text" id="name--legalName--firstNameLocal" name="legalName--firstNameLocal"></div>
    <div id="wrap-system"><label for="_systemfield_name">Name</label><input type="text" id="_systemfield_name" name="_systemfield_name"></div>
    <div id="wrap-tel"><label for="8039f8aa">Phone</label><input type="tel" id="8039f8aa" name="8039f8aa"></div>
    <div id="wrap-text-phone"><label for="0d1e2f3a">Phone</label><input type="text" id="0d1e2f3a" name="0d1e2f3a"></div>
    <div id="wrap-text-linkedin"><label for="dbb7e595">LinkedIn Profile</label><input type="text" id="dbb7e595" name="dbb7e595"></div>
    <fieldset id="emergency"><legend>Emergency contact</legend><label for="em-tel">Phone</label><input type="tel" id="em-tel" name="5c1d"></fieldset>
    <div id="wrap-dial"><label for="dial-tel">Phone</label><div style="display:none"><input id="dial-search" type="search" aria-label="Search"></div><input id="dial-tel" type="tel" name="phone"></div>
    <div id="wrap-hidden-email"><div hidden><input type="email" name="email"></div><label for="shown-tel">Phone</label><input id="shown-tel" type="tel" name="phone"></div>
    <div id="wrap-aria-search"><label for="aria-tel">Phone</label><div aria-hidden="true"><input id="aria-search" type="search" aria-label="Search"></div><input id="aria-tel" type="tel" name="phone"></div>
    <div id="wrap-far-search"><label for="far-tel">Phone</label><input id="far-search" type="search" aria-label="Search"><input id="far-tel" type="tel" name="phone"></div>
    <div id="wrap-two-shown"><input type="search" aria-label="Search"><input type="tel" name="phone"></div>
    <div id="host"></div>
  </form></body></html>`)
})

describe('reading standard field evidence from the DOM', () => {
  it('reads autocomplete, an exact bracketed name and an associated label', () => {
    expect(read('wrap-first')).toBe('given-name')
    expect(read('first')).toBe('given-name')
    expect(read('wrap-email', 'E-Mail')).toBe('email')
  })

  it('uses aria-labelledby, aria-label and legend text as corroboration and refusal evidence', () => {
    expect(read('aria')).toBe('family-name')
    expect(read('aria-conflict')).toBeNull()
    expect(read('aria-sensitive')).toBeNull()
    expect(read('eeo-country')).toBeNull()
    expect(read('legend-tel')).toBe('tel')
  })

  it('refuses through the field name the adapter reports', () => {
    expect(read('first', 'Referrer first name')).toBeNull()
    expect(read('first', 'Last name')).toBeNull()
  })

  it('refuses ambiguous metadata', () => {
    expect(read('ambiguous', 'Name')).toBeNull()
    expect(read('two')).toBeNull()
  })

  it('takes the one visible control and ignores hidden companions', () => {
    expect(read('combo')).toBe('address-level2')
  })

  it('refuses hidden, concealed, disabled, read-only and detached fields', () => {
    expect(read('hidden')).toBeNull()
    expect(read('concealed')).toBeNull()
    expect(read('disabled')).toBeNull()
    expect(read('readonly')).toBeNull()
    expect(read('aria-disabled')).toBeNull()
    const detached = byId('first')
    detached.remove()
    expect(readStandardField(detached, { fieldName: '', section: '' }, null)).toBeNull()
  })

  it('needs a rendered field', () => {
    const field = document.getElementById('first')
    if (!(field instanceof HTMLElement)) throw new Error('missing first')
    setRect(field, { height: 0, width: 0, x: 0, y: 0 })
    field.setAttribute('style', 'display:none')
    expect(readStandardField(field, { fieldName: '', section: '' }, null)).toBeNull()
  })

  it('reads a native select only with a place-shaped option list', () => {
    expect(read('country', 'Country', ['Select...', 'Germany', 'France', 'Spain'])).toBe('country')
    expect(read('country', 'Country', ['Yes', 'No', 'Other'])).toBeNull()
    expect(read('country', 'Country', null)).toBeNull()
  })

  it('refuses a local-script name path, a generic label on a plain text input and a contact of someone else', () => {
    expect(read('wrap-local', 'Thai Given Name')).toBeNull()
    expect(read('wrap-text-phone', 'Phone')).toBeNull()
    expect(read('wrap-text-linkedin', 'LinkedIn Profile')).toBeNull()
    expect(read('wrap-tel', 'Phone extension')).toBeNull()
    expect(read('wrap-system', 'Referrer name (if relevant)')).toBeNull()
    expect(read('em-tel', 'Phone')).toBeNull()
    expect(read('em-tel', 'Phone', null, 'Emergency contact')).toBeNull()
  })

  it('uses the one rendered control and ignores an unrendered companion', () => {
    expect(read('wrap-dial', 'Phone')).toBe('tel')
    expect(read('wrap-hidden-email', 'Phone')).toBe('tel')
    expect(read('wrap-two-shown', 'Phone')).toBeNull()
  })

  it('reads an exact system-name field and an exact native phone field', () => {
    expect(read('wrap-system', 'Name')).toBe('name')
    expect(read('wrap-tel', 'Phone')).toBe('tel')
  })

  it('ignores an aria-hidden companion control', () => {
    for (const id of ['aria-search', 'aria-tel']) shown(document.getElementById(id))
    expect(read('wrap-aria-search', 'Phone')).toBe('tel')
  })

  it('ignores an off-canvas companion control', () => {
    shown(document.getElementById('far-tel'))
    setRect(document.getElementById('far-search')!, { height: 30, width: 300, x: -9999, y: 10 })
    expect(read('wrap-far-search', 'Phone')).toBe('tel')
  })

  it('refuses a wrapper with two visible controls', () => {
    expect(read('wrap-two-shown', 'Phone')).toBeNull()
  })

  it('refuses textareas, file inputs and a button-only CV uploader', () => {
    expect(read('notes')).toBeNull()
    expect(read('cv-field', 'Upload résumé/CV')).toBeNull()
    expect(read('cv', 'Resume')).toBeNull()
  })

  it('refuses a field inside an education or employment entry', () => {
    expect(read('org-title', 'Title')).toBe('organization-title')
    expect(read('org-title', 'Title', null, 'employment 2')).toBeNull()
    expect(read('first', '', null, 'education 1')).toBeNull()
  })

  it('reads a control and its label inside a shadow root', () => {
    const host = byId('host')
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = '<label for="sh">Email</label><input id="sh" type="email" autocomplete="email">'
    const input = shown(root.querySelector('#sh'))
    expect(readStandardField(input, { fieldName: 'Email', section: '' }, null)).toBe('email')
    expect(readStandardField(host, { fieldName: 'Email', section: '' }, null)).toBe('email')
  })

  it('reads each frame from the document of its own content script', () => {
    expect(read('first')).toBe('given-name')
    realm(
      '<html><body><label for="first">Referrer first name</label><input id="first" autocomplete="given-name"><input id="g" autocomplete="tel"></body></html>',
    )
    expect(read('first')).toBeNull()
    expect(read('g')).toBe('tel')
  })

  it('never changes the field it reads', () => {
    const input = byId('first')
    input.setAttribute('value', 'kept')
    read('first')
    expect(input.getAttribute('value')).toBe('kept')
  })
})

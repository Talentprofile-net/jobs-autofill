import { describe, expect, it } from 'bun:test'

import { installDom, setRect } from '~/core/__fixtures__/domGlobals'
import { claimBoundFields, snapshotFieldAllowlist } from './fieldBinding'

const PAGE = `<html><body><form>
  <div class="field" data-tp-field="first"><label for="f">First Name<span>*</span></label><input id="f" type="text"></div>
  <div class="field" data-tp-field="salary"><label for="s">Expected annual salary (euros)</label><input id="s" type="text"></div>
  <div class="field"><label for="cv">Resume/CV</label><input id="cv" type="file" data-tp-field="cv"></div>
  <div class="field" data-tp-field="cv-wrap"><label for="cvw">Cover letter</label><input id="cvw" type="file"></div>
  <input id="named" name="first_name" data-tp-field="named">
  <div class="field" data-tp-field="mixed"><label for="mx">Resume</label><input id="mx" type="file"><textarea aria-label="Resume text"></textarea></div>
  <div class="field" data-tp-field="many"><span>Skills</span>${Array.from({ length: 65 }, (_, i) => `<input type="checkbox" aria-label="Skill ${i}">`).join('')}</div>
  <div class="field" data-tp-field="hidden" hidden><label for="h">Phone</label><input id="h" type="text"></div>
  <div data-tp-field="twice"><input type="text" aria-label="City"></div>
  <div data-tp-field="twice"><input type="text" aria-label="City"></div>
  <fieldset><legend>Education</legend><div data-tp-field="school"><label for="sc">School</label><input id="sc" type="text"></div></fieldset>
  <fieldset><legend>Emergency contact</legend><fieldset><legend>Address</legend><div><label for="em">Email</label><input id="em" type="email" data-tp-field="emergency"></div></fieldset></fieldset>
  <section><h2>References</h2><h3>Contact details</h3><div><label for="rf">Full name</label><input id="rf" type="text" data-tp-field="reference"></div></section>
  <section><h2>Personal</h2><div><label for="ct">City</label><input id="ct" type="text" data-tp-field="city"></div></section>
  <div><h4>Demographic Survey</h4><div><label for="lo">What is your location?</label><select id="lo" data-tp-field="survey"><option>Germany</option></select></div></div>
</form></body></html>`

const ask = (requestId: string, fieldName: string, fieldType = 'TextInput', section = '') => ({ fieldName, fieldType, requestId, section })

const mount = () => {
  const dom = installDom(PAGE)
  Object.assign(dom.window, { getComputedStyle: () => ({ display: 'block', opacity: '1', position: 'static', visibility: 'visible' }), innerHeight: 900, innerWidth: 1200, scrollX: 0, scrollY: 0 })
  for (const el of Array.from(document.querySelectorAll('*'))) setRect(el, { height: 30, width: 300, x: 10, y: 10 })
}

const ids = (bound: ReturnType<typeof claimBoundFields>) => bound.map((request) => request?.requestId ?? null)

const confirmed = () => {
  mount()
  return snapshotFieldAllowlist('generic')
}

describe('a confirmed fill batch accepts only its frozen field allowlist', () => {
  it('accepts exact registered descriptors and returns the content-owned section', () => {
    const allowlist = confirmed()
    const bound = claimBoundFields(
      [ask('first', 'First Name*'), ask('cv', 'Resume/CV', 'FileUpload'), ask('named', 'first name'), ask('school', 'School', 'TextInput', 'education 1'), ask('city', 'City', 'SimpleDropdown', 'personal')],
      allowlist,
      new Set(),
    )
    expect(ids(bound)).toEqual(['first', 'cv', 'named', 'school', 'city'])
    expect(bound.map((request) => request?.section)).toEqual(['', '', '', 'education 1', ''])
  })

  it('refuses unregistered, retyped, unknown-type and relabelled requests, including a label fragment', () => {
    const allowlist = confirmed()
    const bound = claimBoundFields(
      [
        ask('forged-cv', 'Resume', 'FileUpload'),
        ask('first', 'First Name*', 'FileUpload'),
        ask('first', 'First Name*', 'Banana'),
        ask('cv', 'Resume/CV'),
        ask('cv-wrap', 'Cover letter'),
        ask('salary', 'Expected annual salary in euros'),
        ask('salary', 'Expected annual salary'),
      ],
      allowlist,
      new Set(),
    )
    expect(ids(bound)).toEqual([null, null, null, null, null, null, null])
  })

  it('never trusts the page-supplied section', () => {
    const allowlist = confirmed()
    expect(ids(claimBoundFields([ask('first', 'First Name*', 'TextInput', 'education 2'), ask('school', 'School'), ask('school', 'School', 'TextInput', 'employment 1')], allowlist, new Set()))).toEqual([null, null, null])
  })

  it('refuses ambiguous wrappers, oversized control sets, duplicated markers, hidden fields and malformed requests', () => {
    const allowlist = confirmed()
    const bound = claimBoundFields(
      [ask('mixed', 'Resume', 'FileUpload'), ask('mixed', 'Resume'), ask('many', 'Skills', 'MultiCheckbox'), ask('twice', 'City'), ask('hidden', 'Phone'), null, 'first', { fieldName: 'First Name*', requestId: 'first' }, ask('first', '')],
      allowlist,
      new Set(),
    )
    expect(ids(bound)).toEqual([null, null, null, null, null, null, null, null, null])
  })

  it('refuses third-party and demographic fields, including nested contexts, but not a field after an earlier references section', () => {
    const allowlist = confirmed()
    const bound = claimBoundFields([ask('emergency', 'Email'), ask('reference', 'Full name'), ask('survey', 'What is your location?', 'SimpleDropdown'), ask('city', 'City')], allowlist, new Set())
    expect(ids(bound)).toEqual([null, null, null, 'city'])
  })

  it('serves each field once per batch', () => {
    const allowlist = confirmed()
    const served = new Set<string>()
    expect(ids(claimBoundFields([ask('first', 'First Name*'), ask('first', 'First Name*')], allowlist, served))).toEqual(['first', null])
    expect(ids(claimBoundFields([ask('first', 'First Name*')], allowlist, served))).toEqual([null])
  })

  it('keeps the confirmed descriptors when the page relabels, retypes, replaces or adds fields afterwards', () => {
    const allowlist = confirmed()
    document.querySelector('label[for="f"]')!.textContent = 'Expected annual salary in euros'
    document.getElementById('s')!.setAttribute('type', 'file')
    const fresh = document.createElement('div')
    fresh.setAttribute('data-tp-field', 'named')
    fresh.innerHTML = '<input type="text" aria-label="first name">'
    document.getElementById('named')!.replaceWith(fresh)
    const late = document.createElement('div')
    late.setAttribute('data-tp-field', 'late')
    late.innerHTML = '<label for="lt">Resume</label><input id="lt" type="file">'
    document.querySelector('form')!.append(late)
    setRect(late, { height: 30, width: 300, x: 10, y: 10 })
    const bound = claimBoundFields(
      [ask('first', 'Expected annual salary in euros'), ask('salary', 'Expected annual salary (euros)', 'FileUpload'), ask('named', 'first name'), ask('late', 'Resume', 'FileUpload'), ask('first', 'First Name*')],
      allowlist,
      new Set(),
    )
    expect(ids(bound)).toEqual([null, null, null, null, 'first'])
  })
})

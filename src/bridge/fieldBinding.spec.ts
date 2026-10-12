import { describe, expect, it } from 'bun:test'

import { installDom, setRect } from '~/core/__fixtures__/domGlobals'
import { claimBoundFields } from './fieldBinding'

const PAGE = `<html><body><form>
  <div class="field" data-tp-field="first"><label for="f">First Name<span>*</span></label><input id="f" type="text"></div>
  <div class="field" data-tp-field="salary"><label for="s">Expected annual salary (euros)</label><input id="s" type="text"></div>
  <div class="field"><label for="cv">Resume/CV</label><input id="cv" type="file" data-tp-field="cv"></div>
  <input id="named" name="first_name" data-tp-field="named">
  <fieldset><legend>Emergency contact</legend><div><label for="em">Email</label><input id="em" type="email" data-tp-field="emergency"></div></fieldset>
  <div class="field" data-tp-field="hidden" hidden><label for="h">Phone</label><input id="h" type="text"></div>
  <div data-tp-field="twice"><input type="text" aria-label="City"></div>
  <div data-tp-field="twice"><input type="text" aria-label="City"></div>
</form></body></html>`

const ask = (requestId: string, fieldName: string, fieldType = 'TextInput', section = '') => ({ fieldName, fieldType, requestId, section })

const claim = (requests: unknown[], served = new Set<string>()) => {
  const dom = installDom(PAGE)
  Object.assign(dom.window, { getComputedStyle: () => ({ display: 'block', opacity: '1', position: 'static', visibility: 'visible' }), innerHeight: 900, innerWidth: 1200, scrollX: 0, scrollY: 0 })
  for (const el of Array.from(document.querySelectorAll('*'))) setRect(el, { height: 30, width: 300, x: 10, y: 10 })
  return claimBoundFields(requests, served).map((request) => request?.requestId ?? null)
}

describe('binding page-supplied fill requests to registered fields', () => {
  it('accepts a request whose type and label match its registered field', () => {
    expect(claim([ask('first', 'First Name*'), ask('cv', 'Resume/CV', 'FileUpload'), ask('named', 'first name')])).toEqual(['first', 'cv', 'named'])
  })

  it('refuses unregistered, retyped and relabelled requests', () => {
    expect(claim([ask('forged-cv', 'Resume', 'FileUpload'), ask('first', 'First Name*', 'FileUpload'), ask('cv', 'Resume/CV'), ask('salary', 'Expected annual salary in euros')])).toEqual([null, null, null, null])
  })

  it('refuses a request reused within a batch, a duplicated marker, a hidden field and a third-party context', () => {
    const served = new Set<string>()
    expect(claim([ask('first', 'First Name'), ask('first', 'First Name')], served)).toEqual(['first', null])
    expect(served.has('first')).toBe(true)
    expect(claim([ask('twice', 'City'), ask('hidden', 'Phone'), ask('emergency', 'Email')])).toEqual([null, null, null])
  })

  it('refuses malformed requests', () => {
    expect(claim([null, 'first', { fieldName: 'First Name', requestId: 'first' }, ask('first', '')])).toEqual([null, null, null, null])
  })
})

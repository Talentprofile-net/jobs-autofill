import { afterEach, describe, expect, it, mock } from 'bun:test'

import { installDom, setRect, shimXPath } from '~/core/__fixtures__/domGlobals'

mock.module('~/ui/picker/iconMount', () => ({ mountPickerIcon: () => null }))
mock.module('~/ui/formWidgetMount', () => ({ mountFormFillButton: () => ({ destroy: () => {} }) }))

const { allFields } = await import('~/field/registry')
const { teardownAllCaptureForms } = await import('~/capture/captureBuffer')
const { RegisterInputs } = await import('~/adapters/generic')
const { claimBoundFields, createServedFields, isStillBound, snapshotFieldAllowlist } = await import('./fieldBinding')

afterEach(() => {
  for (const field of allFields()) field.destroy()
  teardownAllCaptureForms()
})

const PAGE = `<html><body><form id="application">
  <div class="entry"><label for="first">First Name</label><input id="first" type="text"></div>
  <div class="entry"><label for="mail">Email</label><input id="mail" type="email"></div>
  <div class="entry"><label for="country">Country</label><select id="country"><option value="">Select...</option><option>Germany</option><option>France</option></select></div>
  <div class="entry"><label for="cv">Resume/CV</label><input id="cv" type="file"></div>
  <fieldset id="ref"><legend>Willing to relocate?</legend><label for="ref-yes"><input id="ref-yes" type="radio" name="ref" value="yes">Yes</label><label for="ref-no"><input id="ref-no" type="radio" name="ref" value="no">No</label></fieldset>
  <fieldset><legend>Education</legend><div class="entry"><label for="school">School</label><input id="school" type="text"></div></fieldset>
  <fieldset><legend>Emergency contact</legend><div class="entry"><label for="em">Email</label><input id="em" type="email"></div></fieldset>
  <div class="entry" id="decor"><span id="decor-label">Resume</span></div>
  <div class="entry"><label for="ghost">Phone</label><input id="ghost" type="text" hidden></div>
  <div class="entry"><label for="later">Expected annual salary in euros</label><input id="later" type="text"></div>
</form></body></html>`

const mount = () => {
  const dom = installDom(PAGE)
  Object.assign(globalThis, { HTMLSelectElement: dom.HTMLSelectElement, HTMLTextAreaElement: dom.HTMLTextAreaElement, InputEvent: dom.InputEvent })
  Object.assign(dom.window, { getComputedStyle: () => ({ direction: 'ltr', display: 'block', opacity: '1', position: 'static', visibility: 'visible' }), innerHeight: 900, innerWidth: 1200, scrollX: 0, scrollY: 0 })
  shimXPath()
  for (const el of Array.from(document.querySelectorAll('*'))) setRect(el, { height: 20, width: 200, x: 100, y: 100 })
  setRect(document.getElementById('ghost')!, { height: 0, width: 0, x: 0, y: 0 })
  RegisterInputs(document)
}

const registered = (id: string) => {
  const field = allFields().find((f) => f.element === document.getElementById(id))
  if (!field) throw new Error(`${id} is not registered`)
  return { fieldName: field.fieldName, fieldType: field.fieldType, requestId: field.uuid, section: field.section }
}

const confirm = () => snapshotFieldAllowlist('generic')

const claim = (requests: unknown[], confirmed = confirm(), served = createServedFields()) =>
  claimBoundFields(requests, confirmed, snapshotFieldAllowlist('generic'), served).map((request) => request?.requestId ?? null)

describe('a confirmed fill batch releases values only for content-owned field descriptors', () => {
  it('binds every genuine registered descriptor and returns the content-owned section', () => {
    mount()
    const asks = ['first', 'mail', 'country', 'cv', 'ref-yes', 'school'].map(registered)
    expect(claim(asks)).toEqual(asks.map((ask) => ask.requestId))
    expect(registered('school').section).toBe('education 1')
  })

  it('treats a page-created marker only as a correlation key and refuses it on unregistered, hidden or third-party elements', () => {
    mount()
    const confirmed = confirm()
    document.getElementById('decor')!.setAttribute('data-tp-field', 'forged-decor')
    document.getElementById('ghost')!.setAttribute('data-tp-field', 'forged-ghost')
    document.getElementById('em')!.setAttribute('data-tp-field', 'forged-emergency')
    expect(
      claim(
        [
          { fieldName: 'Resume', fieldType: 'FileUpload', requestId: 'forged-decor', section: '' },
          { fieldName: 'Phone', fieldType: 'TextInput', requestId: 'forged-ghost', section: '' },
          { fieldName: 'Email', fieldType: 'TextInput', requestId: 'forged-emergency', section: '' },
          { fieldName: 'Resume', fieldType: 'FileUpload', requestId: 'never-marked', section: '' },
        ],
        confirmed,
      ),
    ).toEqual([null, null, null, null])
  })

  it('refuses a page-created marker present before confirmation and a re-tagged genuine field asked with a forged descriptor', () => {
    document.body.innerHTML = ''
    mount()
    document.getElementById('decor')!.setAttribute('data-tp-field', 'pre-forged')
    document.getElementById('first')!.setAttribute('data-tp-field', 're-tagged')
    expect(
      claim([
        { fieldName: 'Resume', fieldType: 'FileUpload', requestId: 'pre-forged', section: '' },
        { fieldName: 'Resume/CV', fieldType: 'FileUpload', requestId: 're-tagged', section: '' },
        { fieldName: 'Expected annual salary in euros', fieldType: 'TextInput', requestId: 're-tagged', section: '' },
      ]),
    ).toEqual([null, null, null])
  })

  it.each([
    ['first', 'SimpleDropdown'],
    ['first', 'MonthYear'],
    ['first', 'MonthDayYear'],
    ['first', 'RadioGroup'],
    ['first', 'SingleCheckbox'],
    ['first', 'FileUpload'],
    ['country', 'TextInput'],
    ['ref-yes', 'MultiCheckbox'],
    ['cv', 'TextInput'],
    ['first', 'Unknown'],
  ])('refuses the registered %p field requested as %p', (id, fieldType) => {
    mount()
    expect(claim([{ ...registered(id), fieldType }])).toEqual([null])
  })

  it('refuses a relabelled request, a resectioned request and a reused descriptor', () => {
    mount()
    const served = createServedFields()
    const confirmed = confirm()
    const first = registered('first')
    expect(claim([{ ...first, fieldName: 'Expected annual salary in euros' }, { ...first, fieldName: 'First' }, { ...registered('school'), section: '' }, { ...first, section: 'education 1' }], confirmed, served)).toEqual([null, null, null, null])
    expect(claim([first, first], confirmed, served)).toEqual([first.requestId, null])
    expect(claim([first], confirmed, served)).toEqual([null])
  })

  it('refuses both the stale and the new descriptor after a label, type, section, visibility or marker mutation', () => {
    const mutations: Array<[string, () => void, (before: ReturnType<typeof registered>) => Array<ReturnType<typeof registered>>]> = [
      ['label', () => (document.querySelector('label[for="first"]')!.textContent = 'Expected annual salary in euros'), (b) => [b, { ...b, fieldName: 'Expected annual salary in euros' }]],
      ['type', () => document.getElementById('first')!.setAttribute('type', 'file'), (b) => [b, { ...b, fieldType: 'FileUpload' }]],
      [
        'section',
        () => {
          const fieldset = document.createElement('fieldset')
          fieldset.innerHTML = '<legend>Education</legend>'
          document.getElementById('first')!.parentElement!.before(fieldset)
          fieldset.append(document.getElementById('first')!.parentElement!)
        },
        (b) => [b, { ...b, section: 'education 1' }],
      ],
      ['visibility', () => document.getElementById('first')!.setAttribute('hidden', ''), (b) => [b]],
      [
        'marker',
        () => {
          const id = document.getElementById('first')!.getAttribute('data-tp-field')!
          document.getElementById('first')!.removeAttribute('data-tp-field')
          document.getElementById('later')!.setAttribute('data-tp-field', id)
        },
        (b) => [b, { ...b, fieldName: 'Expected annual salary in euros' }],
      ],
      [
        'replacement',
        () => {
          const old = document.getElementById('first')!
          const fresh = old.cloneNode(true)
          old.replaceWith(fresh)
        },
        (b) => [b],
      ],
      [
        'duplicate marker',
        () => document.getElementById('mail')!.setAttribute('data-tp-field', document.getElementById('first')!.getAttribute('data-tp-field')!),
        (b) => [b],
      ],
    ]
    for (const [name, mutate, asks] of mutations) {
      mount()
      const confirmed = confirm()
      const before = registered('first')
      mutate()
      expect({ name, bound: claim(asks(before), confirmed) }).toEqual({ name, bound: asks(before).map(() => null) })
    }
  })

  it('withholds a value whose field mutates between binding and release', () => {
    mount()
    const confirmed = confirm()
    const first = registered('first')
    const [bound] = claimBoundFields([first], confirmed, snapshotFieldAllowlist('generic'), createServedFields())
    expect(bound?.requestId).toBe(first.requestId)
    expect(isStillBound(bound!, confirmed, snapshotFieldAllowlist('generic'))).toBe(true)
    document.querySelector('label[for="first"]')!.textContent = 'Resume/CV'
    expect(isStillBound(bound!, confirmed, snapshotFieldAllowlist('generic'))).toBe(false)
  })
})

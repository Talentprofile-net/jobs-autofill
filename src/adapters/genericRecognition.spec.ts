import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import { installDom, setRect } from '~/core/__fixtures__/domGlobals'
import type { Profile } from '~/api/types'
import type { ProfileValue } from '~/field/types'

mock.module('../ui/picker/iconMount', () => ({ mountPickerIcon: () => null }))
mock.module('../ui/formWidgetMount', () => ({ mountFormFillButton: () => ({ destroy: () => {} }) }))

const { allFields, unregisterField } = await import('../field/registry')
const { teardownAllCaptureForms } = await import('../capture/captureBuffer')

const resetFields = () => {
  for (const field of allFields()) field.destroy()
  teardownAllCaptureForms()
}

afterEach(resetFields)

const { RegisterInputs } = await import('./generic')
const { GenericSelect } = await import('./generic/select')
const { GenericTextInput } = await import('./generic/textInput')
const { fillTypeahead, typeaheadScope } = await import('~/core/typeahead')
const { verifyTextValue } = await import('~/core/verify')
const { Select: ClassicSelect } = await import('./greenhouseClassic/select')
const { Dropdown: ClassicDropdown } = await import('./greenhouseClassic/dropdown')
const { AddressSearchable: ClassicAddress } = await import('./greenhouseClassic/addressSearchable')
const { Dropdown: WorkdayDropdown } = await import('./workday/dropdown')
const { DropdownSearchable: ReactDropdown } = await import('./greenhouseReact/dropdownSearchable')
const { AddressSearchable: ReactAddress } = await import('./greenhouseReact/addressSearchable')

const LEVER = `<html><body>
<form id="application-form">
  <ul>
    <li class="application-question" data-qa="opportunity-location-question">
      <div class="application-label">Are you interested in working out of any of the following office locations? Our job description will have location eligibility for the role. If the role is remote eligible and you wish to be remote, please leave blank.</div>
      <div class="application-field"><div class="application-dropdown"><select id="office" name="opportunityLocationId">
        <option value="">Select...</option>
        <option value="05a11d9d-ac63-45de-9363-be14eb3129d7">New York, NY</option>
        <option value="c6eff7ec-798d-4780-b3e4-bfa6c49b47e6">Boston, MA</option>
        <option value="11111111-0000-0000-0000-000000000001">Portland, OR</option>
        <option value="11111111-0000-0000-0000-000000000002">Portland, ME</option>
      </select></div></div>
    </li>
    <li class="application-question resume"><label><div class="application-label">Resume/CV <span class="required">✱</span></div>
      <div class="application-field"><a href="#" class="postings-btn visible-resume-upload"><span class="filename">Audit_Tester_CV.pdf</span><span class="default-label">ATTACH RESUME/CV</span><input id="resume" class="invisible-resume-upload" name="resume" type="file"></a>
      <span class="resume-upload-failure"><div class="resume-upload-label">Couldn't auto-read resume.</div></span></div></label></li>
    <li class="application-question"><div class="application-label multiple-select">Pronouns</div><div class="application-field"><ul id="candidatePronounsCheckboxes">
      ${['He/him', 'She/her', 'They/them', 'Xe/xem', 'Ze/hir', 'Ey/em', 'Hir/hir', 'Fae/faer', 'Hu/hu', 'Use name only'].map((v) => `<li><label><input type="checkbox" name="pronouns" value="${v}"><span class="application-answer-alternative">${v}</span></label></li>`).join('')}
      <li><label><input type="checkbox" value="Custom" id="customPronounsOption"><span>Custom</span></label></li>
    </ul></div></li>
    <li class="application-question"><label><div class="application-label">Current location <span class="required">✱</span></div>
      <div class="application-field"><input class="location-input" id="location-input" type="text" name="location"><input id="selected-location" type="hidden" name="selectedLocation">
        <div class="dropdown-container"><div class="dropdown-results"></div><div class="dropdown-no-results" style="display:none">No location found. Try entering a different location</div><div class="dropdown-loading-results" style="display:none">Loading</div></div>
      </div></label></li>
    <li class="application-question" id="auth-question"><div class="application-label">Are you authorized to work here?</div><div class="application-field"><ul id="auth-options">
      <li id="auth-yes"><label><input type="radio" name="authorized" value="Yes"><span>Yes</span></label></li>
      <li id="auth-no"><label><input type="radio" name="authorized" value="No"><span>No</span></label></li>
    </ul></div></li>
    <li class="application-question"><label><div class="application-label">Email</div><div class="application-field"><input id="email" type="email" name="email"></div></label></li>
  </ul>
  <div><input type="hidden" name="cards[92a51f92][baseTemplate]"><ul><li class="application-question custom-question"><div>
    <div class="application-label full-width multiple-select"><div class="text">Have you ever been previously employed by Spotify?<span class="required">✱</span></div></div>
    <div class="application-field full-width required-field"><ul data-qa="checkboxes">
      ${['No', 'Yes - Intern', 'Yes - Full Time Employment'].map((v) => `<li><label><input type="checkbox" name="cards[92a51f92][field0]" value="${v}"><span class="application-answer-alternative">${v}</span></label></li>`).join('')}
    </ul></div></div></li></ul></div>
  <div class="application-question"><label><div class="application-label">What is your location?</div><div class="application-field"><div class="application-dropdown"><select id="country">
    <option value="">Select...</option><option value="AF">Afghanistan</option><option value="DE">Germany</option><option value="US">United States</option>
  </select></div></div></label></div>
  <ul><li><label><span>I agree to the <a href="https://example.invalid/privacy">Privacy Policy</a> and terms.</span><input type="checkbox" id="consent" name="consent[marketing]" value="1"></label></li></ul>
  <label for="plain-email">Work email</label><input id="plain-email" type="text" name="work"><button type="button">Verify</button>
  <div class="hint-row"><div class="application-label">Portfolio</div><a href="#">Learn more</a><input id="portfolio" type="text" name="urls[Portfolio]"></div>
  <input type="checkbox" id="lonely-a"><input type="checkbox" id="lonely-b">
</form>
<form id="other-form"><input type="checkbox" name="pronouns" value="Other A"><input type="checkbox" name="pronouns" value="Other B"></form>
</body></html>`

const shimSelects = (dom: ReturnType<typeof installDom>) => {
  const optionsOf = (select: Element) => Array.from(select.querySelectorAll('option')) as HTMLOptionElement[]
  const define = (proto: object, props: Record<string, PropertyDescriptor>) => {
    for (const [name, descriptor] of Object.entries(props)) Object.defineProperty(proto, name, { configurable: true, ...descriptor })
  }
  define(dom.HTMLOptionElement.prototype, {
    disabled: { get(this: HTMLOptionElement) { return this.hasAttribute('disabled') } },
    index: { get(this: HTMLOptionElement) { return optionsOf(this.closest('select')!).indexOf(this) } },
    selected: { get(this: HTMLOptionElement) { return this.hasAttribute('selected') } },
    text: { get(this: HTMLOptionElement) { return (this.textContent ?? '').trim() } },
    value: { get(this: HTMLOptionElement) { return this.getAttribute('value') ?? (this.textContent ?? '').trim() } },
  })
  define(dom.HTMLSelectElement.prototype, {
    options: { get(this: HTMLSelectElement) { return optionsOf(this) } },
    selectedIndex: {
      get(this: HTMLSelectElement) { return Math.max(0, optionsOf(this).findIndex((o) => o.hasAttribute('selected'))) },
      set(this: HTMLSelectElement, index: number) { optionsOf(this).forEach((o, i) => (i === index ? o.setAttribute('selected', '') : o.removeAttribute('selected'))) },
    },
    selectedOptions: { get(this: HTMLSelectElement) { return [optionsOf(this)[this.selectedIndex]].filter(Boolean) } },
    value: { get(this: HTMLSelectElement) { return optionsOf(this)[this.selectedIndex]?.value ?? '' } },
  })
}

const mount = (html = LEVER) => {
  resetFields()
  const dom = installDom(html)
  class TestKeyboardEvent extends dom.Event {
    key: string
    constructor(type: string, init: EventInit & { key?: string } = {}) {
      super(type, init)
      this.key = init.key ?? ''
    }
  }
  Object.assign(globalThis, {
    HTMLSelectElement: dom.HTMLSelectElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
    InputEvent: dom.InputEvent,
    KeyboardEvent: TestKeyboardEvent,
    MouseEvent: dom.Event,
  })
  shimSelects(dom)
  Object.assign(dom.window, { getComputedStyle: () => ({ direction: 'ltr', display: 'block', opacity: '1', visibility: 'visible' }) })
  for (const el of Array.from(document.querySelectorAll('*'))) setRect(el, { height: 20, width: 200, x: 100, y: 100 })
  return dom
}

const byType = (type: string) => allFields().filter((f) => f.fieldType === type)
const fieldFor = (el: Element | null) => allFields().find((f) => f.element === el)

describe('checkbox groups (Lever pronouns and card questions)', () => {
  beforeEach(() => {
    mount()
  })

  it('registers the ten same-name pronoun checkboxes as one ordered MultiCheckbox, even across repeated discovery passes', () => {
    RegisterInputs(document)
    RegisterInputs(document)
    RegisterInputs(document.getElementById('candidatePronounsCheckboxes')!)
    const pronouns = byType('MultiCheckbox').filter((f) => (f.element as HTMLInputElement).name === 'pronouns' && f.element.closest('#application-form'))
    expect(pronouns).toHaveLength(1)
    expect(pronouns[0].fieldName).toBe('Pronouns')
    const parts = Array.from(document.querySelectorAll<HTMLInputElement>('#application-form input[name="pronouns"]'))
    expect(parts).toHaveLength(10)
    expect(parts.filter((p) => p.getAttribute('data-tp-field') === pronouns[0].uuid)).toHaveLength(1)
    expect(parts.filter((p) => p.getAttribute('data-tp-field-part') === pronouns[0].uuid)).toHaveLength(9)
    expect(byType('SingleCheckbox').some((f) => (f.element as HTMLInputElement).name === 'pronouns' && f.element.closest('#application-form'))).toBe(false)
  })

  it('keeps the three-option card question in one MultiCheckbox instead of splitting Multi and Single', () => {
    RegisterInputs(document)
    RegisterInputs(document)
    const card = allFields().filter((f) => (f.element as HTMLInputElement).name === 'cards[92a51f92][field0]')
    expect(card.map((f) => f.fieldType)).toEqual(['MultiCheckbox'])
    expect(card[0].fieldName).toBe('Have you ever been previously employed by Spotify?✱')
  })

  it('collects a group that a subtree pass only partly sees', () => {
    const items = document.querySelectorAll('#candidatePronounsCheckboxes > li')
    RegisterInputs(items[4])
    const group = allFields().filter((f) => (f.element as HTMLInputElement).name === 'pronouns')
    expect(group.map((f) => f.fieldType)).toEqual(['MultiCheckbox'])
    expect(document.querySelectorAll('#application-form input[name="pronouns"][data-tp-field-part]')).toHaveLength(9)
  })

  it('keeps same-name checkboxes in a different form as their own group', () => {
    RegisterInputs(document)
    const other = allFields().filter((f) => f.element.closest('#other-form'))
    expect(other.map((f) => f.fieldType)).toEqual(['MultiCheckbox'])
    expect(other[0].uuid).not.toBe(allFields().find((f) => (f.element as HTMLInputElement).name === 'pronouns' && f.element.closest('#application-form'))!.uuid)
  })

  it('leaves unnamed standalone checkboxes as single checkboxes', () => {
    RegisterInputs(document)
    for (const id of ['lonely-a', 'lonely-b', 'customPronounsOption']) {
      expect(fieldFor(document.getElementById(id))?.fieldType).toBe('SingleCheckbox')
    }
  })

  it('does not register hidden checkboxes into a group', () => {
    document.querySelector('#candidatePronounsCheckboxes')!.setAttribute('aria-hidden', 'true')
    RegisterInputs(document)
    expect(allFields().some((f) => (f.element as HTMLInputElement).name === 'pronouns' && f.element.closest('#application-form'))).toBe(false)
  })
})

const ownersOf = (selector: string) =>
  Array.from(document.querySelectorAll<HTMLInputElement>(selector)).map(
    (el) => el.getAttribute('data-tp-field') ?? el.getAttribute('data-tp-field-part') ?? 'none',
  )

const appendOption = (listSelector: string, type: string, name: string, value: string) => {
  const li = document.createElement('li')
  li.innerHTML = `<label><input type="${type}" name="${name}" value="${value}"><span>${value}</span></label>`
  document.querySelector(listSelector)!.appendChild(li)
  for (const el of Array.from(li.querySelectorAll('*'))) setRect(el, { height: 20, width: 200, x: 100, y: 100 })
  return li
}

describe('radio and checkbox groups under partial and dynamic rescans', () => {
  beforeEach(() => {
    mount()
  })

  it('collects a whole radio group from a subtree pass that sees one option', () => {
    RegisterInputs(document.getElementById('auth-no')!)
    const radios = allFields().filter((f) => f.fieldType === 'RadioGroup')
    expect(radios).toHaveLength(1)
    expect(radios[0].fieldName).toBe('Are you authorized to work here?')
    expect(new Set(ownersOf('input[name="authorized"]'))).toEqual(new Set([radios[0].uuid]))
  })

  it('adds a checkbox option appended after registration to the existing group', () => {
    RegisterInputs(document)
    const before = allFields().length
    const group = allFields().find((f) => f.fieldType === 'MultiCheckbox' && f.element.closest('#application-form') && (f.element as HTMLInputElement).name === 'pronouns')!
    const li = appendOption('#candidatePronounsCheckboxes', 'checkbox', 'pronouns', 'Audit/option')
    RegisterInputs(li)
    RegisterInputs(document)
    expect(allFields().length).toBe(before)
    expect(new Set(ownersOf('#application-form input[name="pronouns"]'))).toEqual(new Set([group.uuid]))
  })

  it('adds a radio option appended after registration to the existing group', () => {
    RegisterInputs(document)
    const before = allFields().length
    const group = allFields().find((f) => f.fieldType === 'RadioGroup')!
    const li = appendOption('#auth-options', 'radio', 'authorized', 'Maybe')
    RegisterInputs(li)
    expect(allFields().length).toBe(before)
    expect(ownersOf('input[name="authorized"]')).toEqual([group.uuid, group.uuid, group.uuid])
  })

  it('upgrades a lone checkbox to one group when a second same-name option appears', () => {
    document.querySelector('#other-form')!.innerHTML = '<ul id="late"><li><label><input type="checkbox" name="late" value="A"><span>A</span></label></li></ul>'
    for (const el of Array.from(document.querySelectorAll('#other-form *'))) setRect(el, { height: 20, width: 200, x: 100, y: 100 })
    RegisterInputs(document)
    expect(allFields().filter((f) => (f.element as HTMLInputElement).name === 'late').map((f) => f.fieldType)).toEqual(['SingleCheckbox'])
    appendOption('#late', 'checkbox', 'late', 'B')
    RegisterInputs(document)
    const late = allFields().filter((f) => (f.element as HTMLInputElement).name === 'late')
    expect(late.map((f) => f.fieldType)).toEqual(['MultiCheckbox'])
    expect(new Set(ownersOf('input[name="late"]'))).toEqual(new Set([late[0].uuid]))
  })

  it('releases ownership when the anchor is removed and rebuilds one group from the rest', () => {
    RegisterInputs(document)
    const group = allFields().find((f) => f.fieldType === 'RadioGroup')!
    document.getElementById('auth-yes')!.remove()
    appendOption('#auth-options', 'radio', 'authorized', 'Later')
    group.destroy()
    RegisterInputs(document)
    const radios = allFields().filter((f) => f.fieldType === 'RadioGroup')
    expect(radios).toHaveLength(1)
    expect(radios[0].uuid).not.toBe(group.uuid)
    expect(document.querySelectorAll(`[data-tp-field-part="${group.uuid}"]`)).toHaveLength(0)
    expect(new Set(ownersOf('input[name="authorized"]'))).toEqual(new Set([radios[0].uuid]))
  })

  it('drops stale part ownership left by a vanished anchor before regrouping', () => {
    RegisterInputs(document)
    const group = allFields().find((f) => f.fieldType === 'RadioGroup')!
    document.getElementById('auth-yes')!.remove()
    unregisterField(group.uuid)
    appendOption('#auth-options', 'radio', 'authorized', 'Later')
    RegisterInputs(document)
    const radios = allFields().filter((f) => f.fieldType === 'RadioGroup')
    expect(radios).toHaveLength(1)
    expect(document.querySelectorAll(`[data-tp-field-part="${group.uuid}"]`)).toHaveLength(0)
  })

  it('adds one interaction listener per group, not one per option or per rescan', () => {
    const form = document.getElementById('application-form')!
    let added = 0
    const original = form.addEventListener.bind(form)
    form.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      if (['input', 'change', 'click', 'keydown'].includes(type)) added++
      original(type, listener, options)
    }) as typeof form.addEventListener
    RegisterInputs(document)
    const afterFirst = added
    RegisterInputs(document)
    RegisterInputs(document.getElementById('candidatePronounsCheckboxes')!)
    expect(added).toBe(afterFirst)
    const groups = allFields().filter((f) => (f.fieldType === 'MultiCheckbox' || f.fieldType === 'RadioGroup') && f.element.closest('#application-form'))
    expect(afterFirst).toBe(groups.length * 4)
  })
})

describe('field labels without volatile text', () => {
  beforeEach(() => {
    mount()
    RegisterInputs(document)
  })

  it('drops the typeahead status text from the location label', () => {
    document.querySelector<HTMLElement>('.dropdown-no-results')!.removeAttribute('style')
    expect(fieldFor(document.getElementById('location-input'))!.fieldName).toBe('Current location ✱')
  })

  it('drops the file name and the attach action from the resume label', () => {
    expect(fieldFor(document.getElementById('resume'))!.fieldName).toBe('Resume/CV ✱')
  })

  it('keeps meaningful inline link text in a consent label', () => {
    expect(fieldFor(document.getElementById('consent'))!.fieldName).toBe('I agree to the Privacy Policy and terms.')
  })

  it('ignores a button next to an explicit label and a link before an unlabeled field', () => {
    expect(fieldFor(document.getElementById('plain-email'))!.fieldName).toBe('Work email')
    expect(fieldFor(document.getElementById('portfolio'))!.fieldName).toBe('Portfolio')
  })

  it('reads a long question from the label block above a select', () => {
    expect(fieldFor(document.getElementById('office'))!.fieldName.startsWith('Are you interested in working out of any of the following office locations?')).toBe(true)
  })

  it('keeps explicit labels and the field count when the form-fill widget host is inserted before the first row', () => {
    mount('<html><body><form id="f"><div id="row-name"><label for="nm">Full Name</label><input id="nm" type="text"></div><div><label for="em">Email</label><input id="em" type="email"></div></form></body></html>')
    const host = document.createElement('div')
    host.setAttribute('data-tp-form-widget', 'true')
    host.attachShadow({ mode: 'open' }).innerHTML = '<div class="row"><button class="primary" type="button">Fill form</button></div>'
    document.getElementById('row-name')!.before(host)
    setRect(host, { height: 20, width: 200, x: 100, y: 100 })
    RegisterInputs(document)
    expect(allFields()).toHaveLength(2)
    expect(fieldFor(document.getElementById('nm'))?.fieldName).toBe('Full Name')
    expect(fieldFor(document.getElementById('em'))?.fieldName).toBe('Email')
  })
})

describe('native select fills only on a unique safe match', () => {
  beforeEach(() => {
    mount()
  })

  const select = (id: string) => {
    const el = document.getElementById(id) as HTMLSelectElement
    const changes: string[] = []
    el.addEventListener('change', () => changes.push(el.value))
    return { changes, el, field: new GenericSelect(el) }
  }
  const choice = (preferred: string, fallbacks: string[] = []): ProfileValue => ({ fallbacks, kind: 'choice', preferred })

  it('selects an office option by its visible text', async () => {
    const { changes, el, field } = select('office')
    expect(await field.fillFromResolved(choice('Boston, MA'))).toEqual({ status: 'filled' })
    expect(el.value).toBe('c6eff7ec-798d-4780-b3e4-bfa6c49b47e6')
    expect(changes).toEqual(['c6eff7ec-798d-4780-b3e4-bfa6c49b47e6'])
  })

  it('reports unsupported for an ambiguous city and leaves the select untouched', async () => {
    const { changes, el, field } = select('office')
    expect(await field.fillFromResolved(choice('Portland'))).toEqual({ status: 'unsupported' })
    expect(el.selectedIndex).toBe(0)
    expect(changes).toEqual([])
  })

  it('reports unsupported when the location has no option and never matches opaque ids', async () => {
    const { el, field } = select('office')
    expect(await field.fillFromResolved(choice('Example City'))).toEqual({ status: 'unsupported' })
    expect(await field.fillFromResolved(choice('05a11d9d-ac63-45de-9363-be14eb3129d7'))).toEqual({ status: 'unsupported' })
    expect(el.selectedIndex).toBe(0)
  })

  it('restores the original choice and reports unsupported when a controlled select reverts later', async () => {
    const { el, field } = select('office')
    el.addEventListener('change', () => {
      setTimeout(() => {
        el.selectedIndex = 0
      }, 30)
    })
    expect(await field.fillFromResolved(choice('Boston, MA'))).toEqual({ status: 'unsupported' })
    expect(el.selectedIndex).toBe(0)
    expect(el.value).toBe('')
  })

  it('falls back from the raw location to the country and accepts a safe option value', async () => {
    const { el, field } = select('country')
    expect(await field.fillFromResolved(choice('Example City, Germany', ['Germany']))).toEqual({ status: 'filled' })
    expect(el.value).toBe('DE')
    const second = select('country')
    second.el.selectedIndex = 0
    expect(await second.field.fillFromResolved(choice('Nowhere', ['US']))).toEqual({ status: 'filled' })
    expect(second.el.value).toBe('US')
  })

  it('skips a placeholder-less select that already shows its first real option and leaves it unchanged', async () => {
    mount('<html><body><form><label for="c">Country</label><select id="c"><option value="AF">Afghanistan</option><option value="DE">Germany</option></select></form></body></html>')
    const { changes, el, field } = select('c')
    expect(await field.fillFromResolved(choice('Germany'))).toEqual({ reason: 'has-value', status: 'skipped' })
    expect(el.value).toBe('AF')
    expect(changes).toEqual([])
  })
})

type Fillable = { fillFromResolved: (value: ProfileValue) => Promise<unknown> }
type ChoiceWidget = {
  build: (picks: string[], options: string[]) => { field: Fillable; selected: () => string }
  markup: (options: string[]) => string
  name: string
  xpaths: Record<string, string>
}

const xpathAsCss = (xpaths: Record<string, string>) => {
  Object.assign(globalThis, { XPathResult: { FIRST_ORDERED_NODE_TYPE: 9, ORDERED_NODE_SNAPSHOT_TYPE: 7 } })
  Object.assign(document, {
    evaluate: (xpath: string, context: ParentNode) => {
      const css = xpaths[xpath]
      if (!css) throw new Error(`unshimmed xpath ${xpath}`)
      const nodes = Array.from(context.querySelectorAll(css))
      return { singleNodeValue: nodes[0] ?? null, snapshotItem: (i: number) => nodes[i] ?? null, snapshotLength: nodes.length }
    },
  })
}

const REACT_SELECT_XPATHS = {
  './/div[starts-with(@class, "select-shell")]/div[not(@*)]': ':scope div[class^="select-shell"] > div:not([class])',
  './/div[starts-with(@class, "select__menu")]': 'div[class^="select__menu"]',
  './/div[starts-with(@class, "select__option")]': 'div[class^="select__option"]',
  './/div[starts-with(@class, "select__single-value")]': 'div[class^="select__single-value"]',
  './/input[@class="select__input"]': 'input[class="select__input"]',
}

const reactSelectMarkup = (flyout: boolean) => () =>
  `<form><div class="select" id="field"><label for="place">Location (City)</label><div class="select-shell"><div><div class="select__control"><div class="select__value-container"><div class="select__placeholder">Select...</div><input class="select__input" id="place"></div>${flyout ? '<button type="button" aria-label="Toggle flyout"></button>' : ''}</div></div></div></div></form>`

const reactSelect = (Ctor: new (el: HTMLElement) => Fillable, opensOnClick: boolean) => (picks: string[], options: string[]) => {
  const root = document.getElementById('field')!
  const shell = root.querySelector('.select-shell')!
  const shown = root.querySelector('.select__placeholder')!
  const input = root.querySelector<HTMLInputElement>('.select__input')!
  const close = () => root.querySelector('.select__menu')?.remove()
  const open = () => {
    close()
    const menu = document.createElement('div')
    menu.className = 'select__menu'
    for (const text of options) {
      const option = document.createElement('div')
      option.className = 'select__option'
      option.textContent = text
      option.addEventListener('click', () => {
        shown.className = 'select__single-value'
        shown.textContent = text
        picks.push(text)
        close()
      })
      menu.appendChild(option)
    }
    shell.appendChild(menu)
  }
  if (opensOnClick) shell.firstElementChild!.addEventListener('click', open)
  input.addEventListener('input', () => (input.value ? open() : close()))
  return { field: new Ctor(root), selected: () => root.querySelector('.select__single-value')?.textContent ?? '' }
}

const CHOICE_WIDGETS: ChoiceWidget[] = [
  {
    build: (picks) => {
      const select = document.querySelector('select')!
      select.addEventListener('change', () => picks.push(select.selectedOptions[0]?.text ?? ''))
      return { field: new ClassicSelect(document.getElementById('field')!), selected: () => select.selectedOptions[0]?.text ?? '' }
    },
    markup: (options) =>
      `<form><div class="field" id="field"><label for="place">Location (City)</label><select id="place"><option value="">Select...</option>${options.map((text, i) => `<option value="${i + 1}">${text}</option>`).join('')}</select></div></form>`,
    name: 'Greenhouse Classic native select',
    xpaths: { './/select': 'select' },
  },
  {
    build: (picks) => {
      const container = document.querySelector('.select2-container')!
      const drop = document.querySelector('.select2-drop')!
      const chosen = document.querySelector('.select2-chosen')!
      const toggle = (open: boolean) => {
        container.classList.toggle('select2-dropdown-open', open)
        drop.classList.toggle('select2-drop-active', open)
      }
      container.querySelector('a')!.addEventListener('mousedown', () => toggle(!container.classList.contains('select2-dropdown-open')))
      for (const li of Array.from(drop.querySelectorAll('li'))) {
        li.addEventListener('mouseup', () => {
          chosen.textContent = li.textContent
          picks.push(li.textContent ?? '')
          toggle(false)
        })
      }
      return { field: new ClassicDropdown(document.getElementById('field')!), selected: () => chosen.textContent ?? '' }
    },
    markup: (options) =>
      `<form><div class="field" id="field"><label>Location (City)</label><div class="select2-container" id="s2id_place"><a class="select2-choice"><span class="select2-chosen">Select...</span></a><label for="s2id_autogen1" class="select2-offscreen"></label><input class="select2-focusser" id="s2id_autogen1"></div></div></form><div class="select2-drop"><div class="select2-search"><label for="s2id_autogen1_search" class="select2-offscreen"></label><input id="s2id_autogen1_search"></div><ul class="select2-results">${options.map((text) => `<li class="select2-result"><div class="select2-result-label">${text}</div></li>`).join('')}</ul></div>`,
    name: 'Greenhouse Classic select2 dropdown',
    xpaths: {
      ".//div[contains(@class, 'select2-container')]": 'div[class*="select2-container"]',
      ".//div[contains(@class, 'select2-drop-active')][.//label[@for='s2id_autogen1_search']]": 'div[class*="select2-drop-active"]:has(label[for="s2id_autogen1_search"])',
      './/a': 'a',
      './/li': 'li',
      './label': ':scope > label',
    },
  },
  {
    build: (picks, options) => {
      const complete = document.querySelector('auto-complete')!
      const input = document.querySelector<HTMLInputElement>('#place')!
      const list = document.querySelector('#place-popup')!
      input.addEventListener('input', () => {
        list.innerHTML = ''
        complete.removeAttribute('open')
        if (!input.value) return
        for (const text of options) {
          const li = document.createElement('li')
          li.textContent = text
          li.addEventListener('click', () => {
            complete.setAttribute('value', text)
            input.value = text
            picks.push(text)
            complete.removeAttribute('open')
            list.innerHTML = ''
          })
          list.appendChild(li)
        }
        complete.setAttribute('open', '')
      })
      return { field: new ClassicAddress(document.getElementById('field')!), selected: () => complete.getAttribute('value') ?? '' }
    },
    markup: () =>
      '<form><div class="field" id="field"><label for="place">Location (City)</label><auto-complete for="place-popup"><input type="text" id="place"><ul id="place-popup"></ul></auto-complete></div></form>',
    name: 'Greenhouse Classic address search',
    xpaths: {
      ".//input[@type='text']": 'input[type="text"]',
      './/auto-complete': 'auto-complete',
      './/auto-complete[@open]': 'auto-complete[open]',
      './/ul/li': ':scope ul > li',
    },
  },
  {
    build: (picks, options) => {
      const button = document.querySelector('button')!
      button.addEventListener('click', () => {
        const wasOpen = button.getAttribute('aria-expanded') === 'true'
        button.setAttribute('aria-expanded', String(!wasOpen))
        document.getElementById('place-list')?.remove()
        if (wasOpen) return
        const list = document.createElement('ul')
        list.setAttribute('id', 'place-list')
        list.setAttribute('role', 'listbox')
        for (const text of options) {
          const li = document.createElement('li')
          li.setAttribute('role', 'option')
          li.innerHTML = `<div>${text}</div>`
          li.addEventListener('click', () => {
            button.textContent = text
            picks.push(text)
            button.setAttribute('aria-expanded', 'false')
            list.remove()
          })
          list.appendChild(li)
        }
        document.body.appendChild(list)
      })
      return { field: new WorkdayDropdown(document.getElementById('field')!), selected: () => button.textContent ?? '' }
    },
    markup: () =>
      '<form><div data-automation-id="formField-location" id="field"><label for="place">Location (City)</label><button type="button" id="place" aria-haspopup="listbox" aria-expanded="false" aria-controls="place-list">Select One</button></div></form>',
    name: 'Workday dropdown',
    xpaths: {
      ".//body//ul[@id='place-list']": 'body ul[id="place-list"]',
      './/button[@aria-haspopup="listbox"]': 'button[aria-haspopup="listbox"]',
      './/li[.//div]': 'li:has(div)',
      './div': ':scope > div',
    },
  },
  { build: reactSelect(ReactDropdown, true), markup: reactSelectMarkup(true), name: 'Greenhouse React searchable dropdown', xpaths: REACT_SELECT_XPATHS },
  { build: reactSelect(ReactAddress, false), markup: reactSelectMarkup(false), name: 'Greenhouse React address search', xpaths: REACT_SELECT_XPATHS },
]

const NOT_FILLED = [{ reason: 'no-match', status: 'skipped' }, { status: 'unsupported' }]

const RELAXED_ROWS = [
  { candidate: 'Berlin', options: ['Berlin, NH, United States', 'Berlin, Germany'], outcomes: NOT_FILLED, picked: null },
  { candidate: 'Congo', options: ['Congo (Republic of the)', 'Congo (Democratic Republic of the)'], outcomes: NOT_FILLED, picked: null },
  { candidate: 'Berlin, Germany', options: ['Berlin, NH, United States', 'Berlin, Germany'], outcomes: [{ status: 'filled' }], picked: 'Berlin, Germany' },
  { candidate: 'Congo', options: ['Congo (Republic of the)', 'Germany'], outcomes: [{ status: 'filled' }], picked: 'Congo (Republic of the)' },
]

describe('ATS single-choice adapters never pick one of several relaxed matches', () => {
  const choice = (preferred: string): ProfileValue => ({ fallbacks: [], kind: 'choice', preferred })

  for (const widget of CHOICE_WIDGETS) {
    it(`${widget.name}: selects nothing when two options relax-match the value, and still picks a unique match`, async () => {
      for (const row of RELAXED_ROWS) {
        const dom = mount(`<html><body>${widget.markup(row.options)}</body></html>`)
        Object.assign(dom.window, { scrollTo: () => {} })
        xpathAsCss(widget.xpaths)
        const picks: string[] = []
        const { field, selected } = widget.build(picks, row.options)
        const before = selected()
        const outcome = await field.fillFromResolved(choice(row.candidate))
        expect(row.outcomes.map((o) => JSON.stringify(Object.entries(o).sort()))).toContain(JSON.stringify(Object.entries(Object(outcome)).sort()))
        expect({ candidate: row.candidate, picks, selected: selected() }).toEqual({
          candidate: row.candidate,
          picks: row.picked ? [row.picked] : [],
          selected: row.picked ?? before,
        })
      }
    })
  }
})

describe('Greenhouse React phone country picker', () => {
  const PHONE_COUNTRIES = ['United States +1', 'Canada +1', 'Thailand +66', 'Guernsey +44', 'Jersey +44', 'United Kingdom +44', 'Germany +49']
  const choice = (preferred: string, fallbacks: string[]): ProfileValue => ({ fallbacks, kind: 'choice', preferred })

  it('selects the profile country, follows a consistent phone dial code, and selects nothing when the phone contradicts the country', async () => {
    const rows: Array<[ProfileValue, string | null]> = [
      [choice('Thailand', ['TH', 'THA']), 'Thailand +66'],
      [choice('Thailand', ['TH', 'THA', '+66']), 'Thailand +66'],
      [choice('United Kingdom', ['GB', 'GBR', '+44']), 'United Kingdom +44'],
      [choice('Thailand', ['TH', 'THA', '+44']), null],
    ]
    for (const [value, expected] of rows) {
      const dom = mount(`<html><body>${reactSelectMarkup(true)()}</body></html>`)
      Object.assign(dom.window, { scrollTo: () => {} })
      xpathAsCss(REACT_SELECT_XPATHS)
      const picks: string[] = []
      const { field, selected } = reactSelect(ReactDropdown, true)(picks, PHONE_COUNTRIES)
      const before = selected()
      await field.fillFromResolved(value)
      expect({ picks, selected: selected() }).toEqual({ picks: expected ? [expected] : [], selected: expected ?? before })
    }
  })
})

describe('Greenhouse React form for a profile with a country and no city', () => {
  const THAILAND_NO_CITY: Profile = {
    city: null,
    description: null,
    education: null,
    experience: null,
    hourlyRate: null,
    id: 'audit-profile',
    isAvailableForHire: null,
    isInterestedInRelocation: null,
    jobTitle: null,
    languages: null,
    links: null,
    location: 'Thailand',
    monthlyRate: null,
    profileName: 'Audit Tester',
    rateCurrency: null,
    skills: null,
    talentAnswers: null,
    talentNotes: null,
    totalExperience: null,
    user: { email: 'audit.tester@example.invalid', phoneNumber: '0995503642' },
  }

  const fillWith = async (Ctor: new (el: HTMLElement) => Fillable, flyout: boolean, label: string, options: string[]) => {
    const dom = mount(`<html><body>${reactSelectMarkup(flyout)().replace('Location (City)', label)}</body></html>`)
    Object.assign(dom.window, { scrollTo: () => {} })
    xpathAsCss(REACT_SELECT_XPATHS)
    const picks: string[] = []
    const { field, selected } = reactSelect(Ctor, flyout)(picks, options)
    const outcome = await field.fillFromResolved(resolveField(label, 'SimpleDropdown', '', THAILAND_NO_CITY).value)
    return { outcome, picks, selected: selected() }
  }

  it('selects Thailand in the phone Country picker and leaves Location (City) empty', async () => {
    const country = await fillWith(ReactDropdown, true, 'Country*', ['United States +1', 'Canada +1', 'Thailand +66', 'United Kingdom +44', 'Jersey +44', 'Germany +49'])
    expect({ picks: country.picks, selected: country.selected }).toEqual({ picks: ['Thailand +66'], selected: 'Thailand +66' })
    const city = await fillWith(ReactAddress, false, 'Location (City)*', ['Bangkok, Thailand', 'Chiang Mai, Thailand'])
    expect(city).toEqual({ outcome: { status: 'unsupported' }, picks: [], selected: '' })
  })
})

type Suggest = { results: string[]; delayMs?: number; sync?: boolean; revertAfterMs?: number }

const leverTypeahead = (suggest: Suggest) => {
  const input = document.getElementById('location-input') as HTMLInputElement
  const selected = document.getElementById('selected-location') as HTMLInputElement
  const results = document.querySelector<HTMLElement>('.dropdown-results')!
  const noResults = document.querySelector<HTMLElement>('.dropdown-no-results')!
  let chosen = ''
  input.addEventListener('input', () => {
    chosen = ''
    selected.value = ''
    const query = input.value.toLowerCase()
    const render = () => {
      results.innerHTML = ''
      const hits = suggest.results.filter((r) => r.toLowerCase().includes(query.split(',')[0].trim()))
      for (const hit of hits) {
        const row = document.createElement('div')
        row.className = 'dropdown-location'
        row.textContent = hit
        row.addEventListener('click', () => {
          chosen = hit
          input.value = hit
          selected.value = hit
          results.innerHTML = ''
          if (suggest.revertAfterMs !== undefined) setTimeout(() => (input.value = ''), suggest.revertAfterMs)
        })
        results.appendChild(row)
      }
      noResults.setAttribute('style', hits.length ? 'display:none' : '')
    }
    if (suggest.sync) render()
    else setTimeout(render, suggest.delayMs ?? 5)
  })
  input.addEventListener('blur', () => {
    if (!chosen) input.value = ''
  })
  return { input, selected }
}

const FAST = { pollMs: 5, settleTimeoutMs: 200, suggestionsTimeoutMs: 300 }

describe('typeahead text inputs (Lever location)', () => {
  beforeEach(() => {
    mount()
  })

  it('detects the Lever location input as a typeahead but not a plain text input', () => {
    expect(typeaheadScope(document.getElementById('location-input') as HTMLInputElement)).not.toBeNull()
    expect(typeaheadScope(document.getElementById('email') as HTMLInputElement)).toBeNull()
  })

  it('selects the one matching suggestion through a click and keeps it after blur', async () => {
    const { input, selected } = leverTypeahead({ results: ['Example City, Example Region', 'Other Town, Example Region'] })
    const field = new GenericTextInput(input)
    expect(await field.fillFromResolved({ confidence: 'exact', kind: 'string', value: 'Example City' })).toEqual({ status: 'filled' })
    expect(input.value).toBe('Example City, Example Region')
    expect(selected.value).toBe('Example City, Example Region')
  })

  it('reports unsupported for an ambiguous suggestion list and leaves no partial value', async () => {
    const { input, selected } = leverTypeahead({ results: ['Springfield, IL', 'Springfield, MA'] })
    expect(await fillTypeahead(input, typeaheadScope(input)!, ['Springfield'], FAST)).toBe(false)
    expect(input.value).toBe('')
    expect(selected.value).toBe('')
  })

  it('reports unsupported when the page shows no results', async () => {
    const { input } = leverTypeahead({ results: [] })
    const field = new GenericTextInput(input)
    expect(await field.fillFromResolved({ confidence: 'exact', kind: 'string', value: 'Example City' })).toEqual({ status: 'unsupported' })
    expect(input.value).toBe('')
  })

  it('does not count a value the page clears on blur as filled', async () => {
    const input = document.getElementById('location-input') as HTMLInputElement
    input.addEventListener('blur', () => (input.value = ''))
    expect(await fillTypeahead(input, typeaheadScope(input)!, ['Example City'], FAST)).toBe(false)
    expect(input.value).toBe('')
  })

  it('takes synchronously rendered suggestions without waiting for the timeout', async () => {
    const { input, selected } = leverTypeahead({ results: ['Example City, Example Region'], sync: true })
    const started = Date.now()
    expect(await fillTypeahead(input, typeaheadScope(input)!, ['Example City'], { ...FAST, suggestionsTimeoutMs: 5_000 })).toBe(true)
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(selected.value).toBe('Example City, Example Region')
  })

  it('ignores stale suggestions that did not respond to the current input', async () => {
    const input = document.getElementById('location-input') as HTMLInputElement
    document.querySelector('.dropdown-results')!.innerHTML = '<div class="dropdown-location">Example City, Example Region</div>'
    expect(await fillTypeahead(input, typeaheadScope(input)!, ['Example City'], FAST)).toBe(false)
    expect(input.value).toBe('')
  })

  it('does not accept free text that persists without any suggestion', async () => {
    const input = document.getElementById('location-input') as HTMLInputElement
    expect(await fillTypeahead(input, typeaheadScope(input)!, ['Example City'], FAST)).toBe(false)
    expect(input.value).toBe('')
  })

  it('reports unsupported when a clicked suggestion reverts, and restores both values', async () => {
    const { input, selected } = leverTypeahead({ results: ['Example City, Example Region'], revertAfterMs: 20 })
    input.value = 'Old Town'
    selected.value = 'old-place-id'
    expect(await fillTypeahead(input, typeaheadScope(input)!, ['Example City'], FAST)).toBe(false)
    expect(input.value).toBe('Old Town')
    expect(selected.value).toBe('old-place-id')
  })

  it('restores the visible value and the hidden place id after an ambiguous attempt', async () => {
    const { input, selected } = leverTypeahead({ results: ['Springfield, IL', 'Springfield, MA'] })
    input.value = 'Old Town'
    selected.value = 'old-place-id'
    expect(await fillTypeahead(input, typeaheadScope(input)!, ['Springfield'], FAST)).toBe(false)
    expect(input.value).toBe('Old Town')
    expect(selected.value).toBe('old-place-id')
  })

  it('never dispatches Enter while typing, selecting or restoring a typeahead value', async () => {
    const rows: [string[], boolean][] = [
      [['Example City, Example Region'], true],
      [[], false],
    ]
    for (const [results, filled] of rows) {
      mount()
      const { input } = leverTypeahead({ results })
      const keys: string[] = []
      input.addEventListener('keydown', (e) => keys.push(e.key))
      expect(await fillTypeahead(input, typeaheadScope(input)!, ['Example City'], FAST)).toBe(filled)
      expect(keys.length).toBeGreaterThan(0)
      expect(keys).not.toContain('Enter')
    }
  })

  it('refuses a lone suggestion whose region conflicts with the requested region', async () => {
    const { input, selected } = leverTypeahead({ results: ['Example City, Other Region'] })
    expect(await fillTypeahead(input, typeaheadScope(input)!, ['Example City, Example Region'], FAST)).toBe(false)
    expect(input.value).toBe('')
    expect(selected.value).toBe('')
  })

  it('still fills an ordinary text input directly', async () => {
    const input = document.getElementById('email') as HTMLInputElement
    const field = new GenericTextInput(input)
    expect(await field.fillFromResolved({ confidence: 'exact', kind: 'string', value: 'audit.tester@example.invalid' })).toEqual({ status: 'filled' })
    expect(input.value).toBe('audit.tester@example.invalid')
  })

  it('restores the original value and does not report filled when the page truncates a typed email', async () => {
    mount('<html><body><form><label for="em">Email</label><input id="em" type="email"></form></body></html>')
    const input = document.querySelector<HTMLInputElement>('#em')!
    input.addEventListener('input', () => (input.value = input.value.slice(0, 10)))
    const outcome = await new GenericTextInput(input).fillFromResolved({ confidence: 'exact', kind: 'string', value: 'audit.tester@example.invalid' })
    expect(outcome.status).not.toBe('filled')
    expect(input.value).toBe('')
  })
})

const hideNative = (selector: string) => {
  for (const el of Array.from(document.querySelectorAll(selector))) setRect(el, { height: 0, width: 0, x: 0, y: 0 })
}

const labelActivates = () => {
  for (const label of Array.from(document.querySelectorAll('label[for]'))) {
    label.addEventListener('click', () => {
      const input = document.getElementById(label.getAttribute('for')!) as HTMLInputElement | null
      if (!input) return
      if (input.type === 'radio') input.checked = true
      else if (input.type === 'checkbox') input.checked = !input.checked
    })
  }
}

const ashbyRadioGroup = (id: string, heading: string, options: string[]) => `
  <div data-field-path="${id}"><fieldset class="ashby-application-form-input-radio-group">
    <label class="ashby-application-form-question-title" for="${id}">${heading}</label>
    ${options.map((o, i) => `<div class="option"><span class="circle-box"><input type="radio" id="${id}-r${i}" name="${id}-name" class="native"></span><label for="${id}-r${i}">${o}</label></div>`).join('')}
  </fieldset></div>`

const ASHBY = `<html><body><div id="root"><div id="ashby-form" class="ashby-application-form-container">
  <div><label for="name">Full Name</label><input id="name" type="text"></div>
  <div><label for="email">Email</label><input id="email" type="email"></div>
  ${ashbyRadioGroup('pronouns', 'What pronouns would you like our team to use when addressing you?', ['He/Him', 'She/Her', 'They/Them', 'Xe/Xem', 'Prefer not to say'])}
  ${ashbyRadioGroup('gender', 'Gender', ['Male', 'Female', 'Decline to self-identify'])}
  ${ashbyRadioGroup('race', 'Race', ['Hispanic or Latino', 'White', 'Black or African American', 'Asian', 'Native Hawaiian or Other Pacific Islander', 'American Indian or Alaska Native', 'Two or More Races', 'Decline to self-identify'])}
  ${ashbyRadioGroup('veteran', 'Veteran Status', ['I am a veteran', 'I am not a veteran', 'Decline to self-identify'])}
  <div data-field-path="heard"><fieldset class="ashby-application-form-input-checkbox-group">
    <label class="ashby-application-form-question-title" for="heard">How did you hear about this opportunity? (select all that apply)</label>
    ${['LinkedIn', 'Glassdoor', 'Notion Blog', 'Notion Employee', 'Notion Website', 'Billboard/Outdoor Ads', 'Conference or Meetup'].map((o, i) => `<div class="option"><span class="box"><input type="checkbox" id="heard-c${i}" name="${o}" class="native"></span><label for="heard-c${i}">${o}</label></div>`).join('')}
  </fieldset></div>
  ${['anchor', 'sponsor'].map((id) => `<div class="entry"><label class="ashby-application-form-question-title" for="${id}">${id === 'anchor' ? 'Are you able to commit to working from one of our offices on Anchor Days each week?' : 'Will you now or in the future require sponsorship?'}</label>
    <div class="ashby-application-form-input-yesno" id="${id}-yesno"><button type="button" aria-pressed="false" data-option="yes">Yes</button><button type="button" aria-pressed="false" data-option="no">No</button><input type="checkbox" class="hidden-native" tabindex="-1" name="${id}"></div></div>`).join('')}
  <div class="honeypot" id="trap"><input type="radio" id="trap-a" name="trap" class="native"><label for="trap-a" id="trap-label-a">A</label><input type="radio" id="trap-b" name="trap" class="native"><label for="trap-b" id="trap-label-b">B</label></div>
</div></div></body></html>`

describe('Ashby: visually hidden native options and Yes/No toggles (26 options)', () => {
  beforeEach(() => {
    mount(ASHBY)
    hideNative('input.native, input.hidden-native')
    setRect(document.getElementById('trap-label-a')!, { height: 20, width: 40, x: -9999, y: 100 })
    setRect(document.getElementById('trap-label-b')!, { height: 20, width: 40, x: -9999, y: 100 })
    labelActivates()
    for (const button of Array.from(document.querySelectorAll('button[aria-pressed]'))) {
      button.addEventListener('click', () => {
        for (const sibling of Array.from(button.parentElement!.querySelectorAll('button[aria-pressed]'))) sibling.setAttribute('aria-pressed', String(sibling === button))
      })
    }
    RegisterInputs(document)
    RegisterInputs(document)
  })

  it('recognizes every one of the 26 hidden-native options through its visible label', () => {
    const options = Array.from(document.querySelectorAll<HTMLInputElement>('input.native')).filter((el) => el.name !== 'trap')
    expect(options).toHaveLength(26)
    const owned = options.filter((el) => el.hasAttribute('data-tp-field') || el.hasAttribute('data-tp-field-part'))
    expect(owned).toHaveLength(26)
  })

  it('registers one descriptor per question with its heading as the name', () => {
    const groups = allFields().filter((f) => f.fieldType === 'RadioGroup' || f.fieldType === 'MultiCheckbox')
    expect(groups.map((f) => `${f.fieldType}|${f.fieldName}`).sort()).toEqual([
      'MultiCheckbox|How did you hear about this opportunity? (select all that apply)',
      'RadioGroup|Are you able to commit to working from one of our offices on Anchor Days each week?',
      'RadioGroup|Gender',
      'RadioGroup|Race',
      'RadioGroup|Veteran Status',
      'RadioGroup|What pronouns would you like our team to use when addressing you?',
      'RadioGroup|Will you now or in the future require sponsorship?',
    ])
  })

  it('ignores the off-canvas honeypot options', () => {
    expect(['trap-a', 'trap-b'].some((id) => document.getElementById(id)!.hasAttribute('data-tp-field') || document.getElementById(id)!.hasAttribute('data-tp-field-part'))).toBe(false)
  })

  it('fills a hidden-native radio through its label and verifies the checked state', async () => {
    const pronouns = allFields().find((f) => f.fieldName.startsWith('What pronouns'))!
    expect(await pronouns.fillFromResolved({ fallbacks: [], kind: 'choice', preferred: 'She/Her' })).toEqual({ status: 'filled' })
    expect((document.getElementById('pronouns-r1') as HTMLInputElement).checked).toBe(true)
  })

  it('fills a Yes/No toggle and verifies aria-pressed', async () => {
    const toggle = allFields().find((f) => f.fieldName.startsWith('Will you now'))!
    expect(await toggle.fillFromResolved({ fallbacks: [], kind: 'choice', preferred: 'No' })).toEqual({ status: 'filled' })
    expect(document.querySelector('#sponsor-yesno [data-option="no"]')!.getAttribute('aria-pressed')).toBe('true')
  })

  it('refuses a bare "No" multi-choice when two work-model checkbox options share the "No," head', async () => {
    const options = ['Yes, I’m based in this location and able to work from the office 3 days per week', 'No, I’m not based in this location but willing to relocate', 'No, I’m only able to work remotely', 'Other (optional context)']
    mount(`<html><body><div id="root"><div class="ashby-application-form-container"><div data-field-path="model"><fieldset class="ashby-application-form-input-checkbox-group">
      <label class="ashby-application-form-question-title" for="model">Are you currently based in the listed location and able to work in person 3 days per week?</label>
      ${options.map((o, i) => `<div class="option"><span class="box"><input type="checkbox" id="model-c${i}" name="${o}" class="native"></span><label for="model-c${i}">${o}</label></div>`).join('')}
    </fieldset></div></div></div></body></html>`)
    hideNative('input.native')
    labelActivates()
    RegisterInputs(document)
    const group = allFields().find((f) => f.fieldType === 'MultiCheckbox')!
    const outcome = await group.fillFromResolved({ fallbacks: [], kind: 'multiChoice', preferred: ['No'] })
    expect(outcome.status).not.toBe('filled')
    expect(Array.from(document.querySelectorAll<HTMLInputElement>('input.native')).some((el) => el.checked)).toBe(false)
  })

  it('refuses a bare "No" when two office-location radio options share the "No," head', async () => {
    const rows: [string, string[]][] = [
      ['Are you located within 50 miles of one of the following office hubs', ['San Francisco (Union Square)', 'New York (Manhattan)', 'Seattle, Washington', 'London, UK', 'No, but willing to relocate', 'No, and not willing to relocate']],
      ['Are you currently based in the listed location and able to work in person 3 days per week?', ['Yes, I’m based in this location and able to work from the office 3 days per week', 'No, I’m not based in this location but willing to relocate', 'No, I’m only able to work remotely', 'Other (optional context)']],
    ]
    for (const [heading, options] of rows) {
      mount(`<html><body><div id="root"><div class="ashby-application-form-container">${ashbyRadioGroup('reloc', heading, options)}</div></div></body></html>`)
      hideNative('input.native')
      labelActivates()
      RegisterInputs(document)
      const group = allFields().find((f) => f.fieldType === 'RadioGroup')!
      const outcome = await group.fillFromResolved({ fallbacks: ['False'], kind: 'choice', preferred: 'No' })
      expect(outcome.status).not.toBe('filled')
      expect(Array.from(document.querySelectorAll<HTMLInputElement>('input.native')).some((el) => el.checked)).toBe(false)
    }
  })
})

const WORKABLE = `<html><body><form id="wk">
  ${[['q1', 'Do you have the right to work in the UK?'], ['q2', 'Will you require UK visa sponsorship (either now or in the future)?']].map(([id, text]) => `
  <div class="question"><span><strong>*</strong></span><span id="${id}_label"><strong>${text}</strong></span>
    <fieldset role="radiogroup" aria-labelledby="${id}_label">
      <div role="radio" aria-checked="false" tabindex="0" id="${id}-yes" aria-labelledby="${id}_label ${id}_yes_label"><label><input type="radio" aria-hidden="true" tabindex="-1" name="${id}" value="true"><div><span id="${id}_yes_label">YES</span></div></label></div>
      <div role="radio" aria-checked="false" tabindex="-1" id="${id}-no" aria-labelledby="${id}_label ${id}_no_label"><label><input type="radio" aria-hidden="true" tabindex="-1" name="${id}" value="false"><div><span id="${id}_no_label">NO</span></div></label></div>
    </fieldset></div>`).join('')}
  <div><span id="skill_label"><strong>How would you describe your presentation skills?</strong></span>
    <input role="combobox" aria-haspopup="listbox" aria-controls="skill_listbox" aria-expanded="false" aria-labelledby="skill_label" id="skill" type="text" readonly="true" placeholder="Select an option…"><input name="QA_skill" aria-hidden="true" tabindex="-1"></div>
  <div><div role="checkbox" aria-checked="false" tabindex="0" id="agree" aria-label="I agree to the privacy notice"></div></div>
  <div><div class="clicky" tabindex="0" id="clicky">Not a field</div></div>
</form></body></html>`

describe('Workable: ARIA radiogroups, select-only comboboxes and ARIA checkboxes', () => {
  beforeEach(() => {
    mount(WORKABLE)
    hideNative('input[type=radio], input[name="QA_skill"]')
    for (const radio of Array.from(document.querySelectorAll('[role=radio]'))) {
      radio.addEventListener('click', () => {
        for (const sibling of Array.from(radio.parentElement!.querySelectorAll('[role=radio]'))) sibling.setAttribute('aria-checked', String(sibling === radio))
      })
    }
    RegisterInputs(document)
    RegisterInputs(document)
  })

  it('registers each ARIA radiogroup once with its labelled question and both options', () => {
    const groups = allFields().filter((f) => f.fieldType === 'RadioGroup')
    expect(groups.map((f) => f.fieldName)).toEqual(['Do you have the right to work in the UK?', 'Will you require UK visa sponsorship (either now or in the future)?'])
    expect(document.querySelectorAll('input[type=radio][data-tp-field], input[type=radio][data-tp-field-part]')).toHaveLength(0)
  })

  it('fills an ARIA radio by clicking it and verifying aria-checked', async () => {
    const group = allFields().find((f) => f.fieldName.startsWith('Do you have'))!
    expect(await group.fillFromResolved({ fallbacks: [], kind: 'choice', preferred: 'Yes' })).toEqual({ status: 'filled' })
    expect(document.getElementById('q1-yes')!.getAttribute('aria-checked')).toBe('true')
  })

  it('registers the read-only select-only combobox and the stateful ARIA checkbox but not a plain clickable div', () => {
    expect(fieldFor(document.getElementById('skill'))?.fieldType).toBe('SimpleDropdown')
    expect(fieldFor(document.getElementById('skill'))?.fieldName).toBe('How would you describe your presentation skills?')
    expect(fieldFor(document.getElementById('agree'))?.fieldType).toBe('SingleCheckbox')
    expect(fieldFor(document.getElementById('clicky')) === undefined).toBe(true)
  })
})

const FILES = `<html><body><form id="f">
  <div class="flex"><p>Cover Letter</p><div class="wrap"><div class="uploader"><button type="button">Choose File</button><p>No file selected</p></div><input type="file" id="cover" aria-label="file-input"></div><input name="coverLetterFileId" type="hidden"></div>
  <div class="flex"><p>Resume*</p><div class="wrap"><div class="uploader"><button type="button">Choose File*</button><p>No file selected</p></div><input type="file" id="resume" aria-label="file-input" required></div><input name="resumeFileId" type="hidden"></div>
  <div class="flex"><p>Portfolio samples</p><div class="wrap"><input type="file" id="portfolio" aria-label="file-input"></div></div>
  <div><label for="fn">First name<sup aria-hidden="true">*</sup><span class="sr-only">Required</span></label><input id="fn"></div>
  <div><label for="cert">Is certification required?</label><input id="cert"></div>
  <fieldset id="reloc"><legend><span>Are you open to relocating to Dublin for this position?<sup aria-hidden="true">*</sup><span class="sr-only">Required</span></span></legend>
    <label><input type="radio" name="reloc" value="yes">Yes</label><label><input type="radio" name="reloc" value="no">No</label></fieldset>
</form></body></html>`

describe('BambooHR file questions and Teamtailor label noise', () => {
  beforeEach(() => {
    mount(FILES)
    RegisterInputs(document)
  })

  it('names generic file inputs from the nearest question and detects resume and cover letter only', () => {
    expect(fieldFor(document.getElementById('resume'))?.fieldName).toBe('Resume*')
    expect(fieldFor(document.getElementById('cover'))?.fieldName).toBe('Cover Letter')
    expect(fieldFor(document.getElementById('portfolio')) === undefined).toBe(true)
  })

  it('leaves an unresolved cover-letter text answer untouched', async () => {
    mount('<html><body><form><label for="cl">Cover letter</label><textarea id="cl"></textarea></form></body></html>')
    RegisterInputs(document)
    const field = fieldFor(document.getElementById('cl'))!
    expect(await field.fillFromResolved({ kind: 'unsupported' })).toEqual({ status: 'unsupported' })
    expect((document.getElementById('cl') as HTMLTextAreaElement).value).toBe('')
  })

  it('drops visually hidden Required noise but keeps meaningful "required" wording', () => {
    expect(fieldFor(document.getElementById('fn'))?.fieldName).toBe('First name*')
    expect(fieldFor(document.getElementById('cert'))?.fieldName).toBe('Is certification required?')
    expect(allFields().find((f) => f.fieldType === 'RadioGroup')?.fieldName).toBe('Are you open to relocating to Dublin for this position?*')
  })
})

const uploader = (id: string, action: string, question = '') =>
  `<div class="entry">${question}<div class="uploader"><button type="button">${action}</button><input type="file" id="${id}" style="display:none"></div></div>`

describe('button-only document uploaders', () => {
  const page = (body: string) => {
    mount(`<html><body><div id="app"><div class="entry"><label for="nm">Name</label><input id="nm"></div>${body}</div></body></html>`)
    RegisterInputs(document)
  }

  it('names a button-only résumé, CV or cover-letter uploader from its action and strips the verb', () => {
    page(uploader('a', 'Upload résumé') + uploader('b', 'Attach CV') + uploader('c', 'Upload cover letter') + uploader('d', 'Choose your Curriculum Vitae'))
    expect(fieldFor(document.getElementById('a'))?.fieldName).toBe('résumé')
    expect(fieldFor(document.getElementById('b'))?.fieldName).toBe('CV')
    expect(fieldFor(document.getElementById('c'))?.fieldName).toBe('cover letter')
    expect(fieldFor(document.getElementById('d'))?.fieldName).toBe('Curriculum Vitae')
  })

  it('rejects generic, portfolio, writing-sample and other document actions', () => {
    page(['Choose file', 'Upload file', 'Browse', 'Attach', 'Upload portfolio', 'Upload writing sample', 'Upload photo', 'Upload transcript', 'Upload certificate'].map((a, i) => uploader(`g${i}`, a)).join(''))
    expect(allFields().filter((f) => f.fieldType === 'FileUpload')).toHaveLength(0)
  })

  it('lets an explicit question heading win over the button text', () => {
    page(uploader('q', 'Upload CV', '<p>Cover letter</p>'))
    expect(fieldFor(document.getElementById('q'))?.fieldName).toBe('Cover letter')
  })

  it('never turns a file name into the question', () => {
    page(uploader('f', 'Audit_Tester_CV.pdf') + uploader('r', 'Replace resume_final.docx'))
    expect(fieldFor(document.getElementById('f')) === undefined).toBe(true)
    expect(fieldFor(document.getElementById('r')) === undefined).toBe(true)
  })

  it('does not borrow an action from a neighbouring field', () => {
    page('<div class="entry"><input id="other"><button type="button">Upload CV</button><input type="file" id="n" style="display:none"></div>')
    expect(fieldFor(document.getElementById('n')) === undefined).toBe(true)
  })

  it('does not register the Ashby autofill-from-resume parser uploader whose heading follows the input', () => {
    page('<div class="ashby-application-form-autofill-pane"><div role="presentation" class="ashby-application-form-autofill-input-root"><input id="parser" type="file" accept="application/pdf,.pdf" tabindex="-1"><div class="ashby-application-form-autofill-input-base-layer"><div><div><h3>Autofill from resume</h3></div><p>Upload your resume here to autofill key application fields.</p><div><button>Upload file</button></div></div></div></div></div>')
    expect(fieldFor(document.getElementById('parser')) === undefined).toBe(true)
  })

  it('names a Greenhouse React attach widget from its labelled group heading instead of the hidden Attach label', () => {
    mount('<html><body><form><div class="field-wrapper"><div role="group" aria-labelledby="upload-label-resume" class="file-upload"><div id="upload-label-resume" class="label upload-label">Resume/CV<span class="required">*</span></div><div class="file-upload__wrapper"><div class="button-container"><div class="secondary-button"><div><button type="button">Attach</button><label class="visually-hidden" for="resume">Attach</label><input id="resume" class="visually-hidden" type="file" accept=".pdf,.doc,.docx,.txt,.rtf"></div></div><div class="secondary-button"><button type="button">Dropbox</button></div><div class="secondary-button"><button type="button">Google Drive</button></div><div class="secondary-button"><div><button type="button">Enter manually</button><label class="visually-hidden" for="resume_text">Enter manually</label></div></div><p class="file-upload__filetypes">Accepted file types: pdf, doc, docx, txt, rtf</p></div></div></div></div></form></body></html>')
    RegisterInputs(document)
    const field = fieldFor(document.getElementById('resume'))
    expect(field?.fieldType).toBe('FileUpload')
    expect(field?.fieldName).toBe('Resume/CV*')
  })
})

describe('dial-code selectors and site-provided dial prefixes', () => {
  const DIAL = `<html><body><form><label for="cc">Phone</label><select id="cc"><option value="">Select...</option>
    <option value="us">United States (+1)</option><option value="ca">Canada (+1)</option><option value="gb">United Kingdom (+44)</option>
    <option value="de">Germany (+49)</option><option value="th">Thailand (+66)</option><option value="ch">Switzerland (+41)</option></select>
    <label for="ph">Mobile Number</label><input id="ph" type="tel" value="+1"><label for="ph2">Phone</label><input id="ph2" type="tel" value="+41"></form></body></html>`

  beforeEach(() => {
    mount(DIAL)
  })

  it('never puts a phone number or country name into a dial-code select and requires a unique code', async () => {
    const field = new GenericSelect(document.getElementById('cc')!)
    expect(await field.fillFromResolved({ fallbacks: [], kind: 'choice', preferred: '+15555550123' })).toEqual({ status: 'unsupported' })
    expect(await field.fillFromResolved({ fallbacks: [], kind: 'choice', preferred: '+1' })).toEqual({ status: 'unsupported' })
    expect(await field.fillFromResolved({ fallbacks: [], kind: 'choice', preferred: '+44' })).toEqual({ status: 'filled' })
    expect((document.getElementById('cc') as HTMLSelectElement).value).toBe('gb')
  })

  it('replaces an untouched compatible dial prefix but keeps an incompatible one', async () => {
    const plus1 = new GenericTextInput(document.getElementById('ph')!)
    expect(await plus1.fillFromResolved({ confidence: 'exact', kind: 'string', value: '+15555550123' })).toEqual({ status: 'filled' })
    expect((document.getElementById('ph') as HTMLInputElement).value).toBe('+15555550123')
    const plus41 = new GenericTextInput(document.getElementById('ph2')!)
    expect(await plus41.fillFromResolved({ confidence: 'exact', kind: 'string', value: '+15555550123' })).toEqual({ reason: 'has-value', status: 'skipped' })
  })

  it('keeps a dial prefix the user typed', async () => {
    const input = document.getElementById('ph') as HTMLInputElement
    const field = new GenericTextInput(input)
    field.init()
    input.dispatchEvent(new (globalThis.InputEvent)('input', { bubbles: true }))
    expect(await field.fillFromResolved({ confidence: 'exact', kind: 'string', value: '+15555550123' })).toEqual({ reason: 'has-value', status: 'skipped' })
    expect(input.value).toBe('+1')
  })

  it('verifies a phone the page reformats, drops the national 0 from, or shows without its dial code', async () => {
    mount('<html><body><form><label for="ph">Phone</label><input id="ph" type="tel"></form></body></html>')
    const input = document.querySelector<HTMLInputElement>('#ph')!
    const rows: [string, string, boolean][] = [
      ['99 550 3642', '0995503642', true],
      ['99 550 3642', '+66 99 550 3642', true],
      ['(099) 550-3642', '0995503642', true],
      ['12 345', '0995503642', false],
      ['99 550 3643', '0995503642', false],
      ['5 550 3642', '0995503642', false],
    ]
    for (const [shown, wanted, verified] of rows) {
      input.value = shown
      expect([shown, wanted, await verifyTextValue(input, wanted, 0)]).toEqual([shown, wanted, verified])
    }
  })

  it('keeps a national phone number that a Workable-style widget reformats after the dial-code selector', async () => {
    mount('<html><body><form><label for="ph">Phone</label><input id="ph" type="tel"></form></body></html>')
    const input = document.querySelector<HTMLInputElement>('#ph')!
    input.addEventListener('input', () => {
      const digits = input.value.replace(/\D/g, '').replace(/^0/, '')
      input.value = `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5)}`
    })
    const outcome = await new GenericTextInput(input).fillFromResolved({ confidence: 'exact', kind: 'string', value: '0995503642' })
    expect({ outcome, value: input.value }).toEqual({ outcome: { status: 'filled' }, value: '99 550 3642' })
  })

  it('does not verify a text value that kept only the numeric dial prefix', async () => {
    mount('<html><body><form><label for="ph">Phone</label><input id="ph" type="tel"></form></body></html>')
    const input = document.querySelector<HTMLInputElement>('#ph')!
    const rows: [string, boolean][] = [
      ['+49', false],
      ['+49 30 1234567', true],
    ]
    for (const [value, verified] of rows) {
      input.value = value
      expect(await verifyTextValue(input, '+49 30 1234567', 0)).toBe(verified)
    }
  })
})

const { readStandardField } = await import('../ui/picker/standardField')
const { resolveField } = await import('~/resolver/profileResolver')

const BUNQ = `<html><body><div id="page"><button>Apply now</button>
<div id="overlay"><div id="sheet">
  <div id="intro"><p>Nice to meet you!</p><label>Tell us who you are by filling the form below.</label></div>
  <div id="who">
    <div id="row-name"><label for="name">What is your full name?</label><input name="name" placeholder="Emily Clark" value=""></div>
    <div id="row-email"><label for="email">What is your email?</label><input name="email" placeholder="emily@bunq.com" type="email" value=""></div>
    <div id="row-phone"><label for="phone">What is your phone number?</label><input name="phone" placeholder="+31313133131" value=""></div>
  </div>
  <hr>
  <div id="row-country"><label>What country do you currently live in?</label><input name="4415333" value=""></div>
  <div id="row-trap"><div id="trap-box"><label>Leave this empty</label><input name="website" value=""></div></div>
  <div id="row-salary"><label>What are your salary expectations? (gross, annual, in EUR)</label><input name="4415340" value=""></div>
  <div id="row-hidden"><input name="zero" value=""><div aria-hidden="true"><input name="concealed" value=""></div><input name="far-above" value=""></div>
</div></div></div></body></html>`

const place = (el: Element | null, y: number, height: number, x = 0, width = 1280) => setRect(el!, { height, width, x, y })

describe('Recruitee bunq: unassociated wording inside an overlay that overflows above the page', () => {
  const input = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!

  beforeEach(() => {
    mount(BUNQ)
    place(document.getElementById('overlay'), 0, 1457)
    place(document.getElementById('sheet'), -696, 2850)
    place(document.getElementById('intro'), -676, 80)
    place(document.getElementById('who'), -576, 250)
    const rows: [string, string, number][] = [['row-name', 'name', -560], ['row-email', 'email', -470], ['row-phone', 'phone', -380], ['row-country', '4415333', -256]]
    for (const [row, name, y] of rows) {
      place(document.getElementById(row), y, 90)
      place(document.querySelector(`#${row} label`), y, 30)
      place(input(name), y + 34, 56)
    }
    place(document.getElementById('row-trap'), 600, 40)
    place(document.getElementById('trap-box'), 600, 40, -9999, 200)
    place(document.querySelector('#trap-box label'), 600, 20, -9999, 200)
    place(input('website'), 620, 20, -9999, 200)
    place(document.getElementById('row-salary'), 661, 90)
    place(input('4415340'), 695, 56)
    place(document.getElementById('row-hidden'), 760, 120)
    place(input('zero'), 0, 0, 0, 0)
    place(input('concealed'), 770, 30)
    place(input('far-above'), -9000, 30)
    RegisterInputs(document)
  })

  it('registers the four applicant controls above the page top and names them from the nearby wording', () => {
    expect(['name', 'email', 'phone', '4415333', '4415340'].map((name) => fieldFor(input(name))?.fieldName)).toEqual([
      'What is your full name?',
      'What is your email?',
      'What is your phone number?',
      'What country do you currently live in?',
      'What are your salary expectations? (gross, annual, in EUR)',
    ])
  })

  it('still ignores a far-left honeypot inside the same overlay', () => {
    expect(fieldFor(input('website')) ?? null).toBeNull()
  })

  it('still ignores zero-size, concealed and far-above controls outside their container', () => {
    expect(['zero', 'concealed', 'far-above'].map((name) => fieldFor(input(name)) ?? null)).toEqual([null, null, null])
  })

  it('recognizes full name, email, phone and current country, and nothing for salary', () => {
    const standard = (name: string) => {
      const field = fieldFor(input(name))!
      return readStandardField(field.element, { fieldName: field.fieldName, section: field.section }, null)
    }
    expect(['name', 'email', 'phone', '4415333', '4415340'].map(standard)).toEqual(['name', 'email', 'tel', 'country', null])
  })

  it('names a label-less control from its name token and maps first_name to the given name', () => {
    mount('<html><body><form><div><input id="nm" name="first_name" type="text"></div><div><input id="ph" name="name" type="text" placeholder="Audit Tester"></div></form></body></html>')
    RegisterInputs(document)
    const field = fieldFor(document.getElementById('nm'))!
    expect(field.fieldName).toBe('first name')
    expect(readStandardField(field.element, { fieldName: field.fieldName, section: field.section }, null)).toBe('given-name')
  })

  it('takes an example-value placeholder as the name but never maps a bare name token without full-name wording', () => {
    mount('<html><body><form><div><input id="nm" name="first_name" type="text"></div><div><input id="ph" name="name" type="text" placeholder="Audit Tester"></div></form></body></html>')
    RegisterInputs(document)
    const field = fieldFor(document.getElementById('ph'))!
    expect(field.fieldName).toBe('Audit Tester')
    expect(readStandardField(field.element, { fieldName: field.fieldName, section: field.section }, null)).toBeNull()
  })
})

describe('entry sections inside an open shadow root', () => {
  it('names the Education entry section of a shadow-root field and refuses it as the applicant city', () => {
    mount('<html><body><form><div id="host"></div></form></body></html>')
    const root = document.getElementById('host')!.attachShadow({ mode: 'open' })
    root.innerHTML = '<fieldset><legend>Education</legend><label for="edu-city">City</label><input id="edu-city" name="city" type="text"></fieldset>'
    for (const el of Array.from(root.querySelectorAll('*'))) setRect(el, { height: 20, width: 200, x: 100, y: 100 })
    RegisterInputs(document)
    const field = fieldFor(root.querySelector('#edu-city'))!
    expect(field.section).toBe('education 1')
    expect(readStandardField(field.element, { fieldName: field.fieldName, section: field.section }, null)).toBeNull()
  })
})

describe('contenteditable answers', () => {
  it('registers a labelled contenteditable answer as a notes-only field that never fills', () => {
    mount('<html><body><form><div class="q"><span id="note-l">Additional notes</span><div id="note" contenteditable="true" aria-labelledby="note-l"></div></div></form></body></html>')
    RegisterInputs(document)
    const field = fieldFor(document.getElementById('note'))
    expect(field?.fieldType).toBe('ContentEditable')
    expect(field?.isFillable()).toBe(false)
    expect(field?.pickerMode).toBe('notesOnly')
  })
})

const ASHBY_LOCATION = `<html><body><form>
  <div data-field-path="_systemfield_email"><label for="_systemfield_email">Email</label><div><input placeholder="hello@example.com..." name="_systemfield_email" id="_systemfield_email" type="email"></div></div>
  <div data-field-path="_systemfield_location"><label for="_systemfield_location">Location</label><div><input placeholder="Start typing..." aria-autocomplete="list" aria-expanded="false" aria-haspopup="listbox" role="combobox"><button type="button">v</button></div></div>
</form></body></html>`

describe('Ashby id-less location combobox next to the email field', () => {
  beforeEach(() => {
    mount(ASHBY_LOCATION)
    RegisterInputs(document)
  })

  it('registers the id-less location combobox as its own dropdown named from its unmatched block label', () => {
    const combo = fieldFor(document.querySelector('[role="combobox"]'))
    expect(combo).not.toBe(undefined)
    expect(combo?.fieldType).toBe('SimpleDropdown')
    expect(combo?.fieldName).toBe('Location')
  })

  it('keeps the email field off the neighbouring location combobox and gives the combobox no standard meaning', () => {
    const email = fieldFor(document.getElementById('_systemfield_email'))!
    const combo = fieldFor(document.querySelector('[role="combobox"]'))!
    const standard = (field: typeof email) => readStandardField(field.element, { fieldName: field.fieldName, section: field.section }, null)
    expect(email).not.toBe(combo)
    expect(email.fieldName).toBe('Email')
    expect([standard(email), standard(combo)]).toEqual(['email', null])
  })
})

describe('Ashby type-to-search location combobox', () => {
  const searchable = (results: string[], delayMs: number) => {
    mount(ASHBY_LOCATION)
    const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!
    let timer: ReturnType<typeof setTimeout> | null = null
    input.addEventListener('input', () => {
      if (timer) clearTimeout(timer)
      document.getElementById('loc-list')?.remove()
      if (!input.value) return
      timer = setTimeout(() => {
        const list = document.createElement('div')
        list.id = 'loc-list'
        list.setAttribute('role', 'listbox')
        for (const text of results) {
          const option = document.createElement('div')
          option.setAttribute('role', 'option')
          option.textContent = text
          option.addEventListener('click', () => {
            input.value = text
            input.setAttribute('aria-expanded', 'false')
            list.remove()
          })
          list.appendChild(option)
        }
        document.body.appendChild(list)
        setRect(list, { height: 120, width: 300, x: 100, y: 130 })
        for (const option of Array.from(list.children)) setRect(option, { height: 20, width: 300, x: 100, y: 130 })
        input.setAttribute('aria-controls', 'loc-list')
        input.setAttribute('aria-expanded', 'true')
      }, delayMs)
    })
    RegisterInputs(document)
    xpathAsCss({ './/*[@role="option"]': '[role="option"]' })
    return { field: fieldFor(input)!, input }
  }

  it('types into a combobox that shows no list until typing, waits for slow results and picks the first of identical exact options', async () => {
    const { field, input } = searchable(['Bangkok, Thailand', 'Bangkok, Thailand', 'Isan, Thailand', 'Highland Park, Michigan, United States'], 900)
    expect(await field.fillFromResolved({ fallbacks: [], kind: 'choice', preferred: 'Bangkok, Thailand' })).toEqual({ status: 'filled' })
    expect(input.value).toBe('Bangkok, Thailand')
  })

  it('picks nothing when only regions of the country come back', async () => {
    const { field, input } = searchable(['Isan, Thailand', 'Northern Thailand, Thailand', 'Southern Thailand, Thailand'], 100)
    const outcome = await field.fillFromResolved({ fallbacks: [], kind: 'choice', preferred: 'Thailand' })
    expect(outcome.status).not.toBe('filled')
    expect(input.value).toBe('')
  })

  it('gives up within one shared wait and leaves the box empty when the search never answers', async () => {
    const { field, input } = searchable([], 60_000)
    const started = Date.now()
    const outcome = await field.fillFromResolved({ fallbacks: ['Thailand', 'TH', 'THA'], kind: 'choice', preferred: 'Bangkok, Thailand' })
    expect([outcome.status === 'filled', input.value, Date.now() - started < 4900]).toEqual([false, '', true])
  })

  it('still refuses two different relaxed matches', async () => {
    const { field, input } = searchable(['Bangkok, Central Java, Indonesia', 'Bangkok, West Sumatra, Indonesia'], 100)
    const outcome = await field.fillFromResolved({ fallbacks: [], kind: 'choice', preferred: 'Bangkok' })
    expect(outcome.status).not.toBe('filled')
    expect(input.value).toBe('')
  })
})

describe('shadow-host comboboxes', () => {
  it('registers a role=combobox shadow host and the text input inside its open shadow root as one field', () => {
    mount('<html><body><form><x-select id="host" role="combobox" aria-haspopup="listbox"></x-select></form></body></html>')
    const host = document.getElementById('host')!
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = '<input id="inner" type="text">'
    const inner = root.querySelector('#inner')!
    setRect(inner, { height: 20, width: 200, x: 100, y: 100 })
    RegisterInputs(document)
    expect(allFields().filter((f) => f.element === host || f.element === inner)).toHaveLength(1)
  })
})

describe('Lever demographic survey location select', () => {
  it('resolves no bulk-fill value for "What is your location?" under a Demographic Survey heading', () => {
    mount('<html><body><form><div class="section page-centered application-form"><hr><h4>Demographic Survey</h4><div class="application-question"><label><div class="application-label">What is your location?</div><div class="application-field"><div class="application-dropdown"><select class="candidate-location" data-qa="candidate-location-select"><option value="">Select...</option><option value="AF">Afghanistan</option><option value="DE">Germany</option><option value="FR">France</option></select></div></div></label></div></div></form></body></html>')
    RegisterInputs(document)
    const field = fieldFor(document.querySelector('select'))!
    const profile: Profile = {
      description: null,
      education: null,
      experience: null,
      hourlyRate: null,
      id: 'audit-profile',
      isAvailableForHire: null,
      isInterestedInRelocation: null,
      jobTitle: null,
      languages: null,
      links: null,
      location: 'Example City, Germany',
      monthlyRate: null,
      profileName: 'Audit Tester',
      rateCurrency: null,
      skills: null,
      talentAnswers: null,
      talentNotes: null,
      totalExperience: null,
      user: { email: 'audit.tester@example.invalid', phoneNumber: null },
    }
    expect(resolveField(field.fieldName, field.fieldType, field.section, profile).value).toEqual({ kind: 'unsupported' })
  })
})

const { claimBoundFields, createServedFields, snapshotFieldAllowlist } = await import('~/bridge/fieldBinding')
const { describeFields } = await import('~/field/describe/describeFields')
const { shimXPath } = await import('~/core/__fixtures__/domGlobals')
const { detectFormContainer } = await import('~/field/formContainer')

describe('content-owned field descriptions over the recognized fixture forms', () => {
  const FIXTURES = { ASHBY, ASHBY_LOCATION, BUNQ, FILES, LEVER, WORKABLE }

  it('describes exactly the fields the adapters register, with the same name, type, section and visibility', () => {
    for (const [name, html] of Object.entries(FIXTURES)) {
      mount(html)
      shimXPath()
      RegisterInputs(detectFormContainer('generic'))
      const order = Array.from(document.querySelectorAll('*'))
      const row = (d: { element: Element; fieldName: string; fieldType: string; fillable: boolean; section: string; visible: boolean }) =>
        `${order.indexOf(d.element)}|${d.fieldName}|${d.fieldType}|${d.section}|${d.visible}|${d.fillable}`
      const registered = allFields()
        .map((f) => row({ element: f.element, fieldName: f.fieldName, fieldType: f.fieldType, fillable: f.isFillable(), section: f.section, visible: f.isDisplayed() }))
        .sort()
      const described = describeFields('generic').map(row).sort()
      expect({ described, name }).toEqual({ described: registered, name })
    }
  })

  it('binds every registered field descriptor that has a name, exactly as the adapter reports it', () => {
    for (const html of Object.values(FIXTURES)) {
      mount(html)
      shimXPath()
      RegisterInputs(detectFormContainer('generic'))
      const allowlist = snapshotFieldAllowlist('generic')
      const asks = allFields()
        .filter((field) => field.fieldName.trim() !== '' && field.isFillable() && field.isDisplayed())
        .map((field) => ({ fieldName: field.fieldName, fieldType: field.fieldType, requestId: field.uuid, section: field.section }))
      const bound = claimBoundFields(asks, allowlist, snapshotFieldAllowlist('generic'), createServedFields())
      expect(asks.length).toBeGreaterThan(0)
      expect(asks.filter((_, i) => bound[i] === null)).toEqual([])
    }
  })
})

describe('date answers in single text inputs', () => {
  const START = { day: '01', kind: 'date' as const, month: '11', year: '2026' }
  const fillDate = async (markup: string) => {
    mount(`<html><body><form>${markup}</form></body></html>`)
    const input = document.querySelector<HTMLInputElement>('#start')!
    const outcome = await new GenericTextInput(input).fillFromResolved(START)
    return { outcome, value: input.value }
  }

  it('writes the react-datepicker default month/day/year format', async () => {
    expect(await fillDate('<label for="start">When is the soonest you could start?</label><div class="react-datepicker__input-container"><input id="start" type="text" placeholder="Pick date..."></div>')).toEqual({ outcome: { status: 'filled' }, value: '11/01/2026' })
  })

  it('follows a day/month/year placeholder and an ISO date input', async () => {
    expect(await fillDate('<label for="start">Start date</label><input id="start" type="text" placeholder="DD/MM/YYYY">')).toEqual({ outcome: { status: 'filled' }, value: '01/11/2026' })
    expect(await fillDate('<label for="start">Start date</label><input id="start" type="text" placeholder="yyyy-mm-dd">')).toEqual({ outcome: { status: 'filled' }, value: '2026-11-01' })
  })

  it('writes an unambiguous long date when the input gives no format', async () => {
    expect(await fillDate('<label for="start">When can you start?</label><input id="start" type="text">')).toEqual({ outcome: { status: 'filled' }, value: 'November 1, 2026' })
  })

  it('does not write a date without a day into a text input', async () => {
    mount('<html><body><form><label for="start">Start</label><input id="start" type="text"></form></body></html>')
    const input = document.querySelector<HTMLInputElement>('#start')!
    const outcome = await new GenericTextInput(input).fillFromResolved({ kind: 'date', month: '11', year: '2026' })
    expect([outcome.status, input.value]).toEqual(['unsupported', ''])
  })
})

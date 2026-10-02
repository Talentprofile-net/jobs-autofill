import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import { installDom, setRect } from '~/core/__fixtures__/domGlobals'
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

  it('still fills an ordinary text input directly', async () => {
    const input = document.getElementById('email') as HTMLInputElement
    const field = new GenericTextInput(input)
    expect(await field.fillFromResolved({ confidence: 'exact', kind: 'string', value: 'audit.tester@example.invalid' })).toEqual({ status: 'filled' })
    expect(input.value).toBe('audit.tester@example.invalid')
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
})

import { afterEach, describe, expect, it, mock } from 'bun:test'

import { installDom, setRect, shimXPath } from '~/core/__fixtures__/domGlobals'
import { querySelectorAllDeep } from '~/core/shadowDom'

type Mounted = { container: HTMLElement; destroyed: boolean }
const mounts: Mounted[] = []

mock.module('./picker/iconMount', () => ({ mountPickerIcon: () => null }))
mock.module('./formWidgetMount', () => ({
  mountFormFillButton: ({ container }: { container: HTMLElement }) => {
    const entry: Mounted = { container, destroyed: false }
    mounts.push(entry)
    return { destroy: () => (entry.destroyed = true) }
  },
}))

const { allFields } = await import('~/field/registry')
const { destroyAllFormWidgets, refreshFormWidgets, setFormWidgetMode } = await import('./formWidgetManager')
const { RegisterInputs } = await import('~/adapters/generic')

const style = (el: Element) => {
  const inline = el.getAttribute('style') ?? ''
  return { direction: 'ltr', display: /display:\s*none/.test(inline) ? 'none' : 'block', opacity: '1', visibility: 'visible' }
}

const layout = () => {
  for (const el of querySelectorAllDeep(document, '*')) {
    const hidden = style(el).display === 'none'
    setRect(el, hidden ? { height: 0, width: 0, x: 0, y: 0 } : { height: 30, width: 300, x: 100, y: 100 })
  }
}

const clearFields = () => {
  for (const field of allFields()) field.destroy()
}

const mount = (html: string) => {
  clearFields()
  const dom = installDom(`<html><body>${html}</body></html>`)
  Object.assign(dom.window, { getComputedStyle: style, scrollX: 0, scrollY: 0 })
  Object.defineProperty(dom.window, 'location', { configurable: true, value: { hostname: 'apply.example.invalid' } })
  shimXPath()
  layout()
}

const discover = (root: Node = document) => {
  layout()
  RegisterInputs(root)
}

const byId = (id: string) => document.getElementById(id)!
const live = () => mounts.filter((m) => !m.destroyed)
const fileFieldIds = () => allFields().filter((f) => f.fieldType === 'FileUpload').map((f) => f.element.id)

const NAME = (s = '') => `<div class="entry"><label for="n${s}">Name</label><input id="n${s}"></div>`
const EMAIL = (s = '') => `<div class="entry"><label for="e${s}">Email</label><input id="e${s}" type="email"></div>`
const CV = (s = '', action = 'Upload resume') =>
  `<div class="entry uploader"><button type="button">${action}</button><input id="cv${s}" type="file" style="display:none"></div>`
const SAMPLE = (s = '') => `<div class="entry"><label for="doc${s}">Writing sample</label><input id="doc${s}" type="file"></div>`

describe('fill widget for minimal applications without <form>', () => {
  afterEach(() => {
    destroyAllFormWidgets()
    clearFields()
    mounts.length = 0
  })

  it('mounts one widget for name + email + a hidden button-only CV uploader', () => {
    mount(`<div id="job"><h1>Engineer</h1></div><div id="apply">${NAME()}${EMAIL()}${CV()}</div>`)
    discover()
    expect(fileFieldIds()).toEqual(['cv'])
    setFormWidgetMode('application')
    refreshFormWidgets()
    expect(live().map((m) => m.container.id)).toEqual(['apply'])
  })

  it('mounts nothing for name + CV alone', () => {
    mount(`<div id="apply">${NAME()}${CV()}</div>`)
    discover()
    setFormWidgetMode('application')
    refreshFormWidgets()
    expect(live()).toHaveLength(0)
  })

  it('mounts nothing for email + an arbitrary document upload', () => {
    mount(`<div id="apply">${EMAIL()}${SAMPLE()}<div class="entry"><label for="n">Name</label><input id="n" style="display:none"></div></div>`)
    discover()
    expect(fileFieldIds()).toEqual([])
    setFormWidgetMode('application')
    refreshFormWidgets()
    expect(live()).toHaveLength(0)
  })

  it('removes the old widget and mounts exactly one new widget when the whole container is replaced', () => {
    mount(`<div id="apply">${NAME()}${EMAIL()}${CV()}</div>`)
    discover()
    setFormWidgetMode('application')
    refreshFormWidgets()
    const holder = document.createElement('div')
    holder.innerHTML = `<div id="apply-2">${NAME('2')}${EMAIL('2')}${CV('2')}</div>`
    byId('apply').replaceWith(holder.firstElementChild!)
    discover()
    refreshFormWidgets()
    refreshFormWidgets()
    expect(mounts).toHaveLength(2)
    expect(mounts[0].destroyed).toBe(true)
    expect(live().map((m) => m.container.id)).toEqual(['apply-2'])
  })

  it('finds the composed container when the minimal application sits in one open shadow root', () => {
    mount('<div id="page"><apply-form id="host"></apply-form></div>')
    const root = byId('host').attachShadow({ mode: 'open' })
    root.innerHTML = `<div id="apply">${NAME()}${EMAIL()}${CV()}</div>`
    discover()
    setFormWidgetMode('application')
    refreshFormWidgets()
    expect(live().map((m) => m.container.id)).toEqual(['apply'])
    expect(live()[0].container.getRootNode()).toBe(root)
  })

  it('mounts nothing in notes-only mode', () => {
    mount(`<div id="apply">${NAME()}${EMAIL()}${CV()}</div>`)
    discover()
    setFormWidgetMode('notesOnly')
    refreshFormWidgets()
    expect(live()).toHaveLength(0)
  })
})

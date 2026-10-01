import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { installDom, setRect } from '~/core/__fixtures__/domGlobals'
import type { ProfileValue } from '~/field/types'

mock.module('../field/registry', () => ({ registerField: () => {}, unregisterField: () => {} }))
mock.module('../capture/captureBuffer', () => ({
  registerFieldForCapture: () => {},
  unregisterFieldFromCapture: () => {},
}))
mock.module('../ui/picker/iconMount', () => ({ mountPickerIcon: () => null }))

type Adapter = { fill: (value: ProfileValue) => Promise<boolean> }
type AdapterCtor = new (el: HTMLElement) => Adapter

const { GenericFileInput } = await import('./generic/fileInput')
const { File: ReactFile } = await import('./greenhouseReact/file')
const { File: ClassicFile } = await import('./greenhouseClassic/file')

const adapters: Array<[string, AdapterCtor, (id: string) => string, (id: string) => string]> = [
  ['generic', GenericFileInput, (id) => `<label id="${id}-box">Resume <input id="${id}" type="file"></label>`, (id) => id],
  [
    'Greenhouse React',
    ReactFile,
    (id) => `<div class="file-upload" id="${id}-box"><div class="label">Resume/CV</div><input id="${id}" type="file" style="display:none"></div>`,
    (id) => `${id}-box`,
  ],
  [
    'Greenhouse Classic',
    ClassicFile,
    (id) => `<div class="field" id="${id}-box"><label>Resume/CV</label><a>Attach</a><input id="${id}" type="file" style="display:none"></div>`,
    (id) => `${id}-box`,
  ],
]

const CV: ProfileValue = { base64: btoa('%PDF-1.4 audit'), kind: 'file', mimeType: 'application/pdf', name: 'Audit_Tester_CV.pdf' }

class FakeDataTransfer {
  readonly list: File[] = []
  readonly items = { add: (file: File) => this.list.push(file) }
  get files() {
    return this.list
  }
}

const mountCase = (markup: string, wrapper: string) => {
  const dom = installDom(`<html><body><form>
    <div id="case-plain">${markup.replaceAll('ID', 'plain')}</div>
    <div id="case-aria" aria-hidden="true">${markup.replaceAll('ID', 'aria')}</div>
    <div id="case-inert" inert>${markup.replaceAll('ID', 'inert')}</div>
    <div id="case-far" style="position:absolute;left:-9999px">${markup.replaceAll('ID', 'far')}</div>
  </form></body></html>`)
  Object.assign(dom.window, { getComputedStyle: () => ({ direction: 'ltr', display: 'block', visibility: 'visible' }) })
  Object.assign(globalThis, { DataTransfer: FakeDataTransfer })
  for (const el of Array.from(document.querySelectorAll('*'))) setRect(el, { height: 0, width: 0, x: 0, y: 0 })
  for (const id of ['plain', 'aria', 'inert']) setRect(document.getElementById(`${id}-box`)!, { height: 40, width: 400, x: 100, y: 200 })
  setRect(document.getElementById('far-box')!, { height: 40, width: 400, x: -9935, y: 200 })
  return (id: string) => document.getElementById(wrapper.replace('ID', id))!
}

describe('CV attach goes through the same concealment check in every adapter', () => {
  let changes: string[] = []
  beforeEach(() => {
    changes = []
  })

  for (const [index, label] of ['generic', 'Greenhouse React', 'Greenhouse Classic'].entries()) {
    it(`${label}: attaches to a visible uploader and refuses aria-hidden, inert and off-canvas ones`, async () => {
      const [name, Ctor, markup, wrapper] = adapters[index]
      const elementFor = mountCase(markup('ID'), wrapper('ID'))
      for (const id of ['plain', 'aria', 'inert', 'far']) {
        document.getElementById(`case-${id}`)!
          .querySelector('input')!
          .addEventListener('change', () => changes.push(id))
      }
      const results: Record<string, boolean> = {}
      for (const id of ['plain', 'aria', 'inert', 'far']) {
        results[id] = await new Ctor(elementFor(id)).fill(CV)
      }
      const attached = ['plain', 'aria', 'inert', 'far'].filter(
        (id) => (document.querySelector<HTMLInputElement>(`#case-${id} input`)!.files?.length ?? 0) > 0,
      )
      expect({ name, results, attached, changes }).toEqual({
        attached: ['plain'],
        changes: ['plain'],
        name,
        results: { aria: false, far: false, inert: false, plain: true },
      })
    })
  }
})

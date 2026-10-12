import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import { installDom, setRect } from '~/core/__fixtures__/domGlobals'
import type { ProfileValue } from '~/field/types'

mock.module('../ui/formWidgetMount', () => ({ mountFormFillButton: () => ({ destroy: () => {} }) }))
mock.module('../ui/picker/iconMount', () => ({ mountPickerIcon: () => null }))

type Adapter = { fill: (value: ProfileValue) => Promise<boolean> }
type AdapterCtor = new (el: HTMLElement) => Adapter

const { allFields } = await import('../field/registry')
const { teardownAllCaptureForms } = await import('../capture/captureBuffer')

const resetFields = () => {
  for (const field of allFields()) field.destroy()
  teardownAllCaptureForms()
}

afterEach(resetFields)

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
  resetFields()
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

  it('generic: attaches the CV without clicking the file input or opening the native chooser', async () => {
    mountCase(adapters[0][2]('ID'), adapters[0][3]('ID'))
    const input = document.querySelector<HTMLInputElement>('#plain')!
    let clicks = 0
    input.addEventListener('click', () => (clicks += 1))
    Object.assign(input, { showPicker: () => (clicks += 1) })
    const ok = await new GenericFileInput(input).fill(CV)
    expect({ clicks, files: input.files?.length ?? 0, ok }).toEqual({ clicks: 0, files: 1, ok: true })
  })

  it('generic: refuses to attach the PDF CV to an uploader whose accept list excludes PDF', async () => {
    mountCase('<label id="ID-box">Resume <input id="ID" type="file" accept=".doc,.docx"></label>', 'ID')
    const input = document.querySelector<HTMLInputElement>('#plain')!
    input.addEventListener('change', () => changes.push('plain'))
    const ok = await new GenericFileInput(input).fill(CV)
    expect({ changes, files: input.files?.length ?? 0, ok }).toEqual({ changes: [], files: 0, ok: false })
  })

  it('generic: keeps a file the user already attached instead of replacing it with the CV', async () => {
    mountCase(adapters[0][2]('ID'), adapters[0][3]('ID'))
    const input = document.querySelector<HTMLInputElement>('#plain')!
    Object.assign(input, { files: [new File(['x'], 'Own_CV.pdf')] })
    const outcome = await new GenericFileInput(input).fillFromResolved(CV)
    expect({ names: Array.from(input.files ?? []).map((file) => file.name), outcome }).toEqual({
      names: ['Own_CV.pdf'],
      outcome: { reason: 'has-value', status: 'skipped' },
    })
  })
})

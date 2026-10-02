import { describe, expect, it } from 'bun:test'

import { installDom } from '~/core/__fixtures__/domGlobals'
import { createFileAttachLedger, type FileAttachLedger, type LogicalField } from './logicalIdentity'

const field = (element: Element, fieldName: string, fieldType = 'FileUpload', section = ''): LogicalField => ({ element, fieldName, fieldType, section })

const fileInput = (id: string): HTMLInputElement => {
  const input = document.createElement('input')
  input.type = 'file'
  input.id = id
  return input
}

const batch = () => {
  const ledger: FileAttachLedger = createFileAttachLedger()
  const attached: string[] = []
  const pass = (fields: LogicalField[], peers = fields) => {
    for (const current of fields) {
      if (!current.element.isConnected || ledger.claimed(current)) continue
      attached.push(current.element.id)
      ledger.record(current, peers)
    }
  }
  return { attached, pass }
}

const live = (name: string) => Array.from(document.querySelectorAll('input[type="file"]')).map((el) => field(el, name))

describe('logical file-field identity within one fill batch', () => {
  it('keeps one identity across three passes while the page replaces the input each time', () => {
    installDom('<html><body><div id="q"><label>Upload resume*</label><input type="file" id="v1"></div></body></html>')
    const b = batch()
    for (let pass = 1; pass <= 3; pass++) {
      b.pass(live('Upload resume*Required'))
      document.querySelector('#q input')!.replaceWith(fileInput(`v${pass + 1}`))
    }
    expect(b.attached).toEqual(['v1'])
  })

  it('attaches once while the old and the replacement input briefly coexist', () => {
    installDom('<html><body><div id="q"><label>Resume</label><input type="file" id="old"></div></body></html>')
    const b = batch()
    b.pass(live('Resume'))
    document.getElementById('old')!.after(fileInput('new'))
    b.pass(live('Resume'))
    document.getElementById('old')!.remove()
    b.pass(live('Resume'))
    expect(b.attached).toEqual(['old'])
  })

  it('attaches once when both overlapping inputs arrive in the same pass', () => {
    installDom('<html><body><div id="q"><label>Resume</label><input type="file" id="old"><input type="file" id="new"></div></body></html>')
    const b = batch()
    b.pass(live('Resume'))
    expect(b.attached).toEqual(['old'])
  })

  it('keeps the identity when the whole input wrapper is replaced inside a stable question', () => {
    installDom('<html><body><div id="q"><label>Upload your CV</label><div class="dropzone" id="w1"><span>Drag & drop</span><input type="file" id="a"></div></div></body></html>')
    const b = batch()
    b.pass(live('Upload your CV'))
    const wrapper = document.createElement('div')
    wrapper.className = 'dropzone'
    wrapper.innerHTML = '<span>Drag & drop</span><input type="file" id="b">'
    document.getElementById('w1')!.replaceWith(wrapper)
    b.pass(live('Upload your CV'))
    expect(b.attached).toEqual(['a'])
  })

  it('keeps two genuinely distinct same-label questions separate', () => {
    installDom(`<html><body>
      <div class="q"><label>Upload</label><div class="w"><input type="file" id="first"></div></div>
      <div class="q"><label>Upload</label><div class="w"><input type="file" id="second"></div></div></body></html>`)
    const b = batch()
    b.pass(live('Upload'))
    b.pass(live('Upload'))
    expect(b.attached).toEqual(['first', 'second'])
  })

  it('does not rename the second question when the first is removed mid-batch', () => {
    installDom(`<html><body>
      <div class="q" id="q1"><label>Upload</label><input type="file" id="first"></div>
      <div class="q" id="q2"><label>Upload</label><input type="file" id="second"></div></body></html>`)
    const b = batch()
    b.pass(live('Upload'))
    document.getElementById('q1')!.remove()
    document.getElementById('second')!.replaceWith(fileInput('second-v2'))
    b.pass(live('Upload'))
    expect(b.attached).toEqual(['first', 'second'])
  })

  it('still attaches the second question when only the first was attached before it disappeared', () => {
    installDom(`<html><body>
      <div class="q" id="q1"><label>Upload</label><input type="file" id="first"></div>
      <div class="q" id="q2"><label>Upload</label><input type="file" id="second"></div></body></html>`)
    const b = batch()
    const [first, second] = live('Upload')
    b.pass([first], [first, second])
    document.getElementById('q1')!.remove()
    b.pass([second])
    expect(b.attached).toEqual(['first', 'second'])
  })

  it('treats a re-rendered whole question as the same logical question', () => {
    installDom('<html><body><section id="s"><div id="q1"><label>Resume</label><input type="file" id="a"></div></section></body></html>')
    const b = batch()
    b.pass(live('Resume'))
    const fresh = document.createElement('div')
    fresh.innerHTML = '<label>Resume</label><input type="file" id="b">'
    document.getElementById('q1')!.replaceWith(fresh)
    b.pass(live('Resume'))
    expect(b.attached).toEqual(['a'])
  })

  it('tracks a question inside an open shadow root', () => {
    installDom('<html><body><apply-upload id="host"></apply-upload></body></html>')
    const root = document.getElementById('host')!.attachShadow({ mode: 'open' })
    root.innerHTML = '<div id="q"><label>Resume</label><input type="file" id="a"></div>'
    const b = batch()
    const inShadow = () => Array.from(root.querySelectorAll('input')).map((el) => field(el, 'Resume'))
    b.pass(inShadow())
    root.getElementById('a')!.replaceWith(fileInput('b'))
    b.pass(inShadow())
    expect(b.attached).toEqual(['a'])
  })

  it('lets a new user-started batch attach again', () => {
    installDom('<html><body><div><label>Resume</label><input type="file" id="a"></div></body></html>')
    const first = batch()
    first.pass(live('Resume'))
    const second = batch()
    second.pass(live('Resume'))
    expect(first.attached).toEqual(['a'])
    expect(second.attached).toEqual(['a'])
  })

  it('keeps resume and cover letter questions independent', () => {
    installDom('<html><body><div><label>Resume</label><input type="file" id="cv"></div><div><label>Cover letter</label><input type="file" id="cl"></div></body></html>')
    const b = batch()
    b.pass([field(document.getElementById('cv')!, 'Resume'), field(document.getElementById('cl')!, 'Cover letter')])
    expect(b.attached).toEqual(['cv', 'cl'])
  })
})

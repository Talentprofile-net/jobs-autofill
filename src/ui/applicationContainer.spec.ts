import { describe, expect, it } from 'bun:test'

import { installDom } from '~/core/__fixtures__/domGlobals'
import { applicationContainerFor } from './applicationContainer'

const fields = (selector = 'input, textarea, select') => Array.from(document.querySelectorAll(selector))

describe('application container fallback without <form>', () => {
  it('anchors an Ashby-shaped form to its own wrapper, not the page shell', () => {
    installDom(`<html><body><div id="root"><header><nav><input id="search" type="search"></nav></header>
      <div id="job"><h1>Engineer</h1><p>Description</p></div>
      <div id="app-form" class="ashby-application-form-container">
        <div><label for="a">Full Name</label><input id="a" type="text"></div>
        <div><label for="b">Email</label><input id="b" type="email"></div>
        <div><label for="c">Phone</label><input id="c" type="tel"></div>
        <fieldset><label>Pronouns</label><input type="radio" name="p"><input type="radio" name="p"></fieldset>
      </div></div>
      <div id="cookie-banner"><input type="checkbox" id="analytics"><input type="checkbox" id="ads"><input type="text" id="cookie-x"></div></body></html>`)
    expect(applicationContainerFor(fields())?.id).toBe('app-form')
  })

  it('descends from <body> into the child that holds the ADP-style identity step', () => {
    installDom(`<html><body>
      <div id="identity"><p>Tell us about yourself.</p>
        <label>First Name<input id="f"></label><label>Last Name<input id="l"></label>
        <label>Email<input id="e"></label><label>Mobile Number<input id="m" type="tel" value="+1"></label></div>
      <div id="footer-tools"><input id="stray"></div></body></html>`)
    expect(applicationContainerFor(fields())?.id).toBe('identity')
  })

  it('refuses fewer than three fields', () => {
    installDom('<html><body><div id="x"><input id="a"><input id="b"></div></body></html>')
    expect(applicationContainerFor(fields())).toBeNull()
  })

  it('refuses a choice-only cluster with no text-like field', () => {
    installDom('<html><body><div id="x"><input type="checkbox"><input type="checkbox"><input type="radio" name="r"></div></body></html>')
    expect(applicationContainerFor(fields())).toBeNull()
  })

  it('ignores cookie, consent and navigation controls entirely', () => {
    installDom(`<html><body><div id="onetrust-consent-sdk"><input id="a"><input id="b"><input id="c"></div>
      <nav><input id="d"><input id="e"><input id="f"></nav></body></html>`)
    expect(applicationContainerFor(fields())).toBeNull()
  })

  it('refuses when fields are scattered so no single region holds three of them', () => {
    installDom('<html><body><div><input id="a"></div><div><input id="b"></div><div><input id="c"></div></body></html>')
    expect(applicationContainerFor(fields())).toBeNull()
  })
})

import { applicationEvidenceElements, type EvidenceField } from './applicationContainer'

const evidence = (id: string, fieldType: string, fieldName: string, displayed = true): EvidenceField => ({
  attached: true,
  displayed,
  element: document.getElementById(id)!,
  fieldName,
  fieldType,
})

describe('minimal applications without <form>', () => {
  const PAGE = `<html><body><div id="shell"><div id="job"><h1>Engineer</h1></div>
    <div id="apply"><div><label for="n">Name</label><input id="n"></div><div><label for="e">Email</label><input id="e" type="email"></div>
      <div class="uploader"><button type="button">Upload resume</button><input id="cv" type="file" style="display:none"></div>
      <div><label for="doc">Writing sample</label><input id="doc" type="file"></div></div></div></body></html>`

  it('mounts for name + email + CV', () => {
    installDom(PAGE)
    const els = applicationEvidenceElements([evidence('n', 'TextInput', 'Name'), evidence('e', 'TextInput', 'Email'), evidence('cv', 'FileUpload', 'Upload resume')])
    expect(applicationContainerFor(els)?.id).toBe('apply')
  })

  it('does not mount for name + CV alone', () => {
    installDom(PAGE)
    const els = applicationEvidenceElements([evidence('n', 'TextInput', 'Name'), evidence('cv', 'FileUpload', 'Resume')])
    expect(applicationContainerFor(els)).toBeNull()
  })

  it('does not count an arbitrary document upload as application evidence', () => {
    installDom(PAGE)
    const els = applicationEvidenceElements([evidence('e', 'TextInput', 'Email'), evidence('doc', 'FileUpload', 'Writing sample'), evidence('n', 'TextInput', 'Name', false)])
    expect(els.map((el) => el.id)).toEqual(['e'])
    expect(applicationContainerFor(els)).toBeNull()
  })

  it('counts a hidden native CV input whose uploader is displayed', () => {
    installDom(PAGE)
    const els = applicationEvidenceElements([evidence('n', 'TextInput', 'Name'), evidence('e', 'TextInput', 'Email'), evidence('cv', 'FileUpload', 'Resume', true)])
    expect(els).toHaveLength(3)
    expect(applicationContainerFor(els)?.id).toBe('apply')
  })

  it('anchors to the host when the whole application sits in one open shadow root', () => {
    installDom('<html><body><div id="page"><apply-form id="host"></apply-form></div></body></html>')
    const root = document.getElementById('host')!.attachShadow({ mode: 'open' })
    root.innerHTML = '<label for="n">Name</label><input id="n"><label for="e">Email</label><input id="e" type="email"><input id="cv" type="file">'
    const els = ['n', 'e', 'cv'].map((id) => root.getElementById(id)!)
    expect(applicationContainerFor(els)?.id).toBe('host')
  })

  it('follows a replaced container to the new one', () => {
    installDom(PAGE)
    const first = applicationContainerFor(['n', 'e', 'cv'].map((id) => document.getElementById(id)!))
    const fresh = document.createElement('div')
    fresh.id = 'apply-2'
    fresh.innerHTML = '<input id="n2"><input id="e2" type="email"><input id="cv2" type="file">'
    first!.replaceWith(fresh)
    expect(first!.isConnected).toBe(false)
    expect(applicationContainerFor(['n2', 'e2', 'cv2'].map((id) => document.getElementById(id)!))?.id).toBe('apply-2')
  })
})

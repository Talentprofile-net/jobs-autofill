import { describe, expect, it } from 'bun:test'

import { installDom, shimXPath } from '~/core/__fixtures__/domGlobals'
import { detectFormContainer } from './formContainer'

const mount = (html: string) => {
  installDom(`<html><body>${html}</body></html>`)
  shimXPath()
}

const SEARCH = '<form id="search"><input type="search" name="q"><input type="text" name="q2"><button>Go</button></form>'
const field = (id: string) => `<label for="${id}">${id}</label><input id="${id}">`

describe('generic form container', () => {
  it('picks the application form over a smaller site form that comes first', () => {
    mount(`${SEARCH}<form id="apply">${field('first')}${field('last')}${field('email')}<select id="country"></select><textarea id="cover"></textarea></form>`)
    expect(detectFormContainer('generic').id).toBe('apply')
  })

  it('scans the whole document when no form holds enough controls', () => {
    mount(`${SEARCH}<div id="apply">${field('first')}${field('last')}${field('email')}</div>`)
    expect(detectFormContainer('generic')).toBe(document.documentElement)
  })

  it('keeps the outer form when a nested role=form holds the same controls', () => {
    mount(`<form id="outer"><div role="form" id="inner">${field('first')}${field('last')}${field('email')}</div></form>`)
    expect(detectFormContainer('generic').id).toBe('outer')
  })

  it('counts hidden, button and search inputs as no controls', () => {
    mount(`<form id="noise"><input type="hidden"><input type="submit"><input type="button"><input type="search"></form>`)
    expect(detectFormContainer('generic')).toBe(document.documentElement)
  })
})

import { describe, expect, it } from 'bun:test'

import { installDom } from '~/core/__fixtures__/domGlobals'
import { activateControl } from './activate'

const button = (markup: string): HTMLElement => {
  installDom(`<html><body><form>${markup}</form></body></html>`)
  const el = document.getElementById('b')
  if (!(el instanceof HTMLElement)) throw new Error('missing button')
  return el
}

const typeDuringClick = (el: HTMLElement, target: HTMLElement = el): string | null => {
  let seen: string | null = 'unclicked'
  el.addEventListener('click', () => (seen = el.getAttribute('type')))
  activateControl(target)
  return seen
}

describe('activating a control without submitting its form', () => {
  it('clicks a type-less button as a plain button and restores the missing type', () => {
    const el = button('<button id="b" role="combobox">Open</button>')
    expect(typeDuringClick(el)).toBe('button')
    expect(el.hasAttribute('type')).toBe(false)
  })

  it('guards an explicit submit button and a child of a type-less button, then restores the declared type', () => {
    const submit = button('<button id="b" type="submit" aria-pressed="false">Yes</button>')
    expect(typeDuringClick(submit)).toBe('button')
    expect(submit.getAttribute('type')).toBe('submit')
    const parent = button('<button id="b"><span id="inner">No</span></button>')
    expect(typeDuringClick(parent, document.getElementById('inner')!)).toBe('button')
    expect(parent.hasAttribute('type')).toBe(false)
  })

  it('leaves plain buttons and non-button controls untouched', () => {
    const plain = button('<button id="b" type="button">Toggle</button>')
    expect(typeDuringClick(plain)).toBe('button')
    const option = button('<ul><li id="b" role="option">Germany</li></ul>')
    expect(typeDuringClick(option)).toBe(null)
    activateControl(null)
  })
})

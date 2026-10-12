import { describe, expect, it } from 'bun:test'

import { installDom } from '~/core/__fixtures__/domGlobals'
import { inferSection } from './sections'

const PAGE = `<html><body><form>
  <fieldset><legend>Emergency contact</legend><fieldset><legend>Address</legend><input id="nested-legend"></fieldset></fieldset>
  <div role="group" aria-label="Voluntary self-identification"><div role="group" aria-label="Details"><input id="nested-group"></div></div>
  <section><h2>References</h2><h3>Contact details</h3><input id="outline"></section>
  <section><h2>Personal</h2><input id="after-references"></section>
  <div><h4>Demographic Survey</h4><div><label>What is your location?<select id="survey"></select></label></div></div>
  <fieldset><legend>Education</legend><fieldset><legend>Dates</legend><input id="entry"></fieldset></fieldset>
</form></body></html>`

const section = (id: string) => {
  installDom(PAGE)
  const el = document.getElementById(id)
  if (!(el instanceof HTMLElement)) throw new Error(`missing ${id}`)
  return inferSection(el)
}

describe('section context of generic fields', () => {
  it('reports an outer refused container behind a neutral inner one', () => {
    expect(section('nested-legend')).toBe('Emergency contact')
    expect(section('nested-group')).toBe('Voluntary self-identification')
  })

  it('reports a refused parent heading behind a neutral sub-heading and a refused nearest heading', () => {
    expect(section('outline')).toBe('References')
    expect(section('survey')).toBe('Demographic Survey')
  })

  it('does not carry an earlier refused section into the next sibling section', () => {
    expect(section('after-references')).toBe('')
  })

  it('keeps the entry section of a field nested in an entry container', () => {
    expect(section('entry')).toBe('education 1')
  })
})

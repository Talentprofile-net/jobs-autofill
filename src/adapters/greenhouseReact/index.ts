import { getElement, getElements } from '~/core/getElements'
import { TextInput } from './textInput'
import { Textarea } from './textarea'
import { NumberInput } from './numberInput'
import { DropdownSearchable } from './dropdownSearchable'
import { DropdownMultiSearchable } from './dropdownMultiSearchable'
import { AddressSearchable } from './addressSearchable'
import { CheckboxBoolean } from './checkboxBoolean'
import { CheckboxMulti } from './checkboxMulti'
import { File } from './file'
import { Section } from './section'
import { BaseField, isRegistered, isVisible } from '~/field/baseField'

type FieldClass = {
  XPATH: string
  new (el: HTMLElement): BaseField
}

const adapters: FieldClass[] = [
  TextInput,
  Textarea,
  NumberInput,
  DropdownSearchable,
  DropdownMultiSearchable,
  AddressSearchable,
  CheckboxBoolean,
  CheckboxMulti,
  File,
]

const discoverAdapter = (Ctor: FieldClass, root: ParentNode): void => {
  const elements = getElements(root as Node, Ctor.XPATH)
  for (const el of elements) {
    if (isRegistered(el) || !isVisible(el)) continue
    const instance = new Ctor(el)
    instance.init()
  }
}

export const RegisterInputs = (node: Node = document): void => {
  const applicationContainer = getElement(
    document,
    `.//div[contains(concat(' ', normalize-space(@class), ' '), ' application--container ')]`,
  )
  if (!applicationContainer) return
  Section.autoDiscover(node)
  const root = node instanceof Element || node instanceof DocumentFragment ? node : document
  for (const Ctor of adapters) discoverAdapter(Ctor, root)
}
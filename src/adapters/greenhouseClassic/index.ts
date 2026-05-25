import { TextInput } from './textInput'
import { Textarea } from './textarea'
import { Select } from './select'
import { Dropdown } from './dropdown'
import { DropdownSearchable } from './dropdownSearchable'
import { DropdownMulti } from './dropdownMulti'
import { Checkboxes } from './checkboxes'
import { MonthYear } from './monthYear'
import { AddressSearchable } from './addressSearchable'
import { File } from './file'
import { Sections } from './sections'
import { BaseField, isRegistered, isVisible } from '@/field/baseField'
import { getElements } from '~/core/getElements'

type FieldClass = {
  XPATH: string
  new (el: HTMLElement): BaseField
}

const adapters: FieldClass[] = [
  TextInput,
  Textarea,
  Select,
  Dropdown,
  DropdownSearchable,
  DropdownMulti,
  Checkboxes,
  MonthYear,
  AddressSearchable,
  File,
]

const discoverAdapter = (Ctor: FieldClass, node: Node): void => {
  const elements = getElements(node, Ctor.XPATH)
  for (const el of elements) {
    if (isRegistered(el) || !isVisible(el)) continue
    const instance = new Ctor(el)
    instance.init()
  }
}

export const RegisterInputs = async (node: Node = document): Promise<void> => {
  Sections.autoDiscover(node)
  for (const Ctor of adapters) discoverAdapter(Ctor, node)
}
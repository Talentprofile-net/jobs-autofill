import { getElement, getElements } from '~/core/getElements'
import { BooleanCheckbox } from './booleanCheckbox'
import { BooleanRadio } from './booleanRadio'
import { CheckboxesSingle } from './checkboxesSingle'
import { Dropdown } from './dropdown'
import { DropdownSearchable } from './dropdownSearchable'
import { FileMulti } from './fileMulti'
import { Password } from './password'
import { TextArea } from './textArea'
import { TextInput } from './textInput'
import { MonthYear } from './dates/monthYear'
import { MonthDayYear } from './dates/monthDayYear'
import { Year } from './dates/year'
import { BaseField, isRegistered, isVisible } from '~/field/baseField'

type FieldClass = {
  XPATH: string
  new (el: HTMLElement): BaseField
}

const adapters: FieldClass[] = [
  MonthDayYear,
  MonthYear,
  Year,
  Password,
  Dropdown,
  DropdownSearchable,
  BooleanCheckbox,
  TextArea,
  BooleanRadio,
  CheckboxesSingle,
  FileMulti,
  TextInput,
]

const discoverAdapter = (Ctor: FieldClass, node: Node): void => {
  const elements = getElements(node, Ctor.XPATH)
  for (const el of elements) {
    if (isRegistered(el) || !isVisible(el)) continue
    const instance = new Ctor(el)
    instance.init()
  }
}

export const RegisterInputs = (node: Node = document): void => {
  const onSearch = getElement(document, ".//div[@data-automation-id='jobSearch']")
  if (onSearch) return
  for (const Ctor of adapters) discoverAdapter(Ctor, node)
}
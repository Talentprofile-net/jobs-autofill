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
import { BaseField, isRegistered } from '~/field/baseField'
import { walkAtsCandidates } from '~/field/describe/atsSpec'
import { isJobSearchPage, SPEC_ORDER } from './specs'

type FieldClass = {
  XPATH: string
  new (el: HTMLElement): BaseField
}

export const ADAPTER_CLASSES: FieldClass[] = [
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

export const RegisterInputs = (node: Node = document): void => {
  if (isJobSearchPage()) return
  walkAtsCandidates(SPEC_ORDER, node, isRegistered, (index, el) => new ADAPTER_CLASSES[index](el).init())
}
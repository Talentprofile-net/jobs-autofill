import { TextInput } from './textInput'
import { Textarea } from './textarea'
import { Select } from './select'
import { Dropdown } from './dropdown'
import { DropdownSearchable } from './dropdownSearchable'
import { DropdownMulti } from './dropdownMulti'
import { Checkboxes } from './checkboxes'
import { SingleCheckbox } from './singleCheckbox'
import { MonthYear } from './monthYear'
import { AddressSearchable } from './addressSearchable'
import { File } from './file'
import { Sections } from './sections'
import { BaseField, isRegistered } from '~/field/baseField'
import { walkAtsCandidates } from '~/field/describe/atsSpec'
import { SPEC_ORDER } from './specs'

type FieldClass = {
  XPATH: string
  new (el: HTMLElement): BaseField
}

export const ADAPTER_CLASSES: FieldClass[] = [
  TextInput,
  Textarea,
  Select,
  Dropdown,
  DropdownSearchable,
  DropdownMulti,
  Checkboxes,
  SingleCheckbox,
  MonthYear,
  AddressSearchable,
  File,
]

export const RegisterInputs = (node: Node = document): void => {
  Sections.autoDiscover(node)
  walkAtsCandidates(SPEC_ORDER, node, isRegistered, (index, el) => new ADAPTER_CLASSES[index](el).init())
}
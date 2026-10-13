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
import { BaseField, isInsideRegistered } from '~/field/baseField'
import { walkAtsCandidates } from '~/field/describe/atsSpec'
import { hasApplicationContainer, SPEC_ORDER } from './specs'

type FieldClass = {
  XPATH: string
  new (el: HTMLElement): BaseField
}

export const ADAPTER_CLASSES: FieldClass[] = [
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

export const RegisterInputs = (node: Node = document): void => {
  if (!hasApplicationContainer()) return
  Section.autoDiscover(node)
  const root = node instanceof Element || node instanceof DocumentFragment ? node : document
  walkAtsCandidates(SPEC_ORDER, root, isInsideRegistered, (index, el) => new ADAPTER_CLASSES[index](el).init())
}
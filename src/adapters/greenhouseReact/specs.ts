import { getElement } from '~/core/getElements'
import { atsSpec, holdsFileInput, labelledFieldName, type AtsFieldSpec } from '~/field/describe/atsSpec'
import { xpaths } from './xpaths'

export const specs = {
  addressSearchable: atsSpec(xpaths.ADDRESS_SEARCHABLE, 'SimpleDropdown'),
  checkboxBoolean: atsSpec(xpaths.CHECKBOX_BOOLEAN, 'SingleCheckbox', { fieldName: (element) => labelledFieldName(element, './/legend') }),
  checkboxMulti: atsSpec(xpaths.CHECKBOX_MULTI, 'MultiCheckbox', { fieldName: (element) => labelledFieldName(element, './/legend[starts-with(@class, "label")]') }),
  dropdownMultiSearchable: atsSpec(xpaths.DROPDOWN_MULTI_SEARCHABLE, 'MultiSearchableDropdown'),
  dropdownSearchable: atsSpec(xpaths.DROPDOWN_SEARCHABLE, 'SimpleDropdown'),
  file: atsSpec(xpaths.FILE, 'SingleFileUpload', { fieldName: (element) => labelledFieldName(element, './/div[contains(@class, "label")]'), fillable: holdsFileInput }),
  numberInput: atsSpec(xpaths.NUMBER_INPUT, 'TextInput'),
  textInput: atsSpec(xpaths.TEXT_INPUT, 'TextInput'),
  textarea: atsSpec(xpaths.TEXTAREA, 'TextInput'),
}

export const SPEC_ORDER: AtsFieldSpec[] = [
  specs.textInput,
  specs.textarea,
  specs.numberInput,
  specs.dropdownSearchable,
  specs.dropdownMultiSearchable,
  specs.addressSearchable,
  specs.checkboxBoolean,
  specs.checkboxMulti,
  specs.file,
]

export const hasApplicationContainer = (): boolean =>
  getElement(document, `.//div[contains(concat(' ', normalize-space(@class), ' '), ' application--container ')]`) !== null

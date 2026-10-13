import { getElement } from '~/core/getElements'
import { atsSpec, holdsFileInput, labelledFieldName, type AtsFieldSpec } from '~/field/describe/atsSpec'
import { withoutHiddenLabelMarker } from './hiddenLabelMarker'
import { xpaths } from './xpaths'

const classicName = (element: HTMLElement): string => withoutHiddenLabelMarker(labelledFieldName(element))

const classic = (xpath: string, fieldType: string, overrides: Partial<Pick<AtsFieldSpec, 'fieldName' | 'fillable'>> = {}): AtsFieldSpec =>
  atsSpec(xpath, fieldType, { fieldName: classicName, ...overrides })

const checkboxesName = (element: HTMLElement): string =>
  getElement(element, './label[normalize-space(text())]')?.innerText?.trim() || classicName(element)

export const specs = {
  addressSearchable: classic(xpaths.ADDRESS_SEARCH_FIELD, 'SimpleDropdown'),
  checkboxes: classic(xpaths.MULTI_CHECKBOX, 'MultiCheckbox', { fieldName: checkboxesName }),
  dropdown: classic(xpaths.SIMPLE_DROPDOWN, 'SimpleDropdown'),
  dropdownMulti: classic(xpaths.DROPDOWN_MULTI, 'MultiSearchableDropdown'),
  dropdownSearchable: classic(xpaths.DROPDOWN_SEARCHABLE, 'SimpleDropdown'),
  file: classic(xpaths.SINGLE_FILE_UPLOAD, 'SingleFileUpload', { fillable: holdsFileInput }),
  monthYear: classic(xpaths.MONTH_YEAR, 'MonthYear'),
  select: classic(xpaths.BASIC_SELECT, 'SimpleDropdown'),
  singleCheckbox: classic(xpaths.SINGLE_CHECKBOX, 'SingleCheckbox'),
  textInput: classic(xpaths.TEXT_FIELD, 'TextInput'),
  textarea: classic(xpaths.TEXTAREA, 'TextInput'),
}

export const SPEC_ORDER: AtsFieldSpec[] = [
  specs.textInput,
  specs.textarea,
  specs.select,
  specs.dropdown,
  specs.dropdownSearchable,
  specs.dropdownMulti,
  specs.checkboxes,
  specs.singleCheckbox,
  specs.monthYear,
  specs.addressSearchable,
  specs.file,
]

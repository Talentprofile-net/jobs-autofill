import { getElement } from '~/core/getElements'
import { atsSpec, labelledFieldName, neverFillable, type AtsFieldSpec } from '~/field/describe/atsSpec'
import { fixedFieldName } from './fixedFieldName'
import { xpaths } from './xpaths'

export const specs = {
  booleanCheckbox: atsSpec(xpaths.SINGLE_CHECKBOX, 'SingleCheckbox'),
  booleanRadio: atsSpec(xpaths.BOOLEAN_RADIO, 'BooleanRadio', { fieldName: (element) => getElement(element, './/legend')?.innerText ?? '' }),
  checkboxesSingle: atsSpec(xpaths.MULTI_CHECKBOX, 'MultiCheckbox', { fieldName: (element) => fixedFieldName(element) ?? labelledFieldName(element) }),
  dropdown: atsSpec(xpaths.SIMPLE_DROPDOWN, 'SimpleDropdown'),
  dropdownSearchable: atsSpec(xpaths.SEARCHABLE_SINGLE_DROPDOWN, 'SimpleDropdown'),
  fileMulti: atsSpec(xpaths.MULTI_FILE_UPLOAD, 'MultiFileUpload', { fillable: neverFillable }),
  monthDayYear: atsSpec(xpaths.MONTH_DAY_YEAR, 'MonthDayYear'),
  monthYear: atsSpec(xpaths.MONTH_YEAR, 'MonthYear'),
  password: atsSpec(xpaths.PASSWORD_INPUT, 'PasswordInput', { fillable: neverFillable }),
  textArea: atsSpec(xpaths.TEXT_AREA, 'TextInput'),
  textInput: atsSpec(xpaths.TEXT_INPUT, 'TextInput'),
  year: atsSpec(xpaths.YEAR, 'Year'),
}

export const SPEC_ORDER: AtsFieldSpec[] = [
  specs.monthDayYear,
  specs.monthYear,
  specs.year,
  specs.password,
  specs.dropdown,
  specs.dropdownSearchable,
  specs.booleanCheckbox,
  specs.textArea,
  specs.booleanRadio,
  specs.checkboxesSingle,
  specs.fileMulti,
  specs.textInput,
]

export const isJobSearchPage = (): boolean => getElement(document, ".//div[@data-automation-id='jobSearch']") !== null

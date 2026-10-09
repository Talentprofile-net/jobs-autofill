import type { FieldDescriptor } from '~/bridge/types'
import { associatedLabels, isRenderedElement } from '~/adapters/generic/labelResolver'
import { isConcealedControl } from '~/core/concealment'
import { querySelectorAllDeep } from '~/core/shadowDom'
import { decideStandardField, type ControlKind, type StandardField } from '~/resolver/standardField'

const CONTROL_SELECTOR = 'input, select, textarea'
const TEXT_INPUT_TYPES = new Set(['', 'text', 'email', 'tel', 'url', 'search'])

const isControl = (el: HTMLElement): boolean => el.matches(CONTROL_SELECTOR)

const isHiddenInput = (el: HTMLElement): boolean =>
  el.tagName === 'INPUT' && (el.getAttribute('type') ?? '').toLowerCase() === 'hidden'

const controlOf = (field: HTMLElement): HTMLElement | null => {
  if (isControl(field)) return field
  const controls = querySelectorAllDeep<HTMLElement>(field, CONTROL_SELECTOR).filter(
    (el) => !isHiddenInput(el) && isRenderedElement(el) && !isConcealedControl(el),
  )
  return controls.length === 1 ? controls[0] : null
}

const inputTypeOf = (control: HTMLElement): string =>
  control.tagName === 'INPUT' ? (control.getAttribute('type') ?? '').trim().toLowerCase() : ''

const controlKind = (control: HTMLElement): ControlKind => {
  if (control.tagName === 'SELECT') return 'select'
  if (control.tagName === 'TEXTAREA') return 'textarea'
  const type = inputTypeOf(control)
  if (TEXT_INPUT_TYPES.has(type)) return 'text'
  if (type === 'radio' || type === 'checkbox') return 'choice'
  return 'other'
}

const AUTOCOMPLETE_LISTS = new Set(['list', 'both'])

const isCombobox = (control: HTMLElement): boolean =>
  control.getAttribute('role') === 'combobox' ||
  AUTOCOMPLETE_LISTS.has((control.getAttribute('aria-autocomplete') ?? '').toLowerCase()) ||
  control.hasAttribute('list')

const isOperable = (field: HTMLElement, control: HTMLElement): boolean =>
  field.isConnected &&
  control.isConnected &&
  !control.hasAttribute('disabled') &&
  !control.hasAttribute('readonly') &&
  control.getAttribute('aria-disabled') !== 'true' &&
  control.getAttribute('aria-readonly') !== 'true' &&
  isRenderedElement(field) &&
  !isConcealedControl(control)

const readEvidence = (
  field: HTMLElement,
  descriptor: Pick<FieldDescriptor, 'fieldName' | 'section'>,
  optionLabels: string[] | null,
): StandardField | null => {
  const control = controlOf(field)
  if (!control || !isOperable(field, control)) return null
  const decision = decideStandardField({
    autocomplete: control.getAttribute('autocomplete') ?? '',
    combobox: isCombobox(control),
    control: controlKind(control),
    id: control.getAttribute('id') ?? '',
    inputType: inputTypeOf(control),
    labels: [...associatedLabels(control), descriptor.fieldName].filter((text) => text.trim().length > 0),
    name: control.getAttribute('name') ?? '',
    optionLabels,
    section: descriptor.section,
  })
  return 'field' in decision ? decision.field : null
}

export const readStandardField = (
  field: HTMLElement,
  descriptor: Pick<FieldDescriptor, 'fieldName' | 'section'>,
  optionLabels: string[] | null,
): StandardField | null => {
  try {
    return readEvidence(field, descriptor, optionLabels)
  } catch {
    return null
  }
}

import { FIELD_MARKER_ATTR } from '~/config'
import type { BaseField } from '~/field/baseField'
import { domClaims } from '~/field/claims'
import { fieldByUuid } from '~/field/registry'
import { GenericAriaCheckbox, GenericAriaRadioGroup, GenericYesNoToggle } from './ariaChoice'
import { GenericCheckboxBoolean } from './checkboxBoolean'
import { GenericCheckboxMulti } from './checkboxMulti'
import { GenericCombobox } from './combobox'
import { GenericContentEditable } from './contentEditable'
import { GenericDateGroup } from './dateGroup'
import { GenericFileInput } from './fileInput'
import { claimParts, dropStalePart } from './groupParts'
import type { GroupHooks } from './groups'
import { genericCandidates, type GenericCandidate } from './plan'
import { GenericRadioGroup } from './radioGroup'
import { GenericSelect } from './select'
import { GenericTextarea } from './textarea'
import { GenericTextInput } from './textInput'

const ensureRoot = (node: Node): ParentNode => {
  if (node instanceof Element) return node
  if (node === document) return document
  if (node instanceof DocumentFragment) return node
  if (node instanceof ShadowRoot) return node
  return document
}

const registryGroupHooks: GroupHooks = {
  adoptRegistered: (anchor, seed, eligible, out) => {
    const uuid = anchor.getAttribute(FIELD_MARKER_ATTR) ?? ''
    const field = fieldByUuid(uuid)
    if (field?.fieldType === 'MultiCheckbox' || field?.fieldType === 'RadioGroup') {
      claimParts(anchor, uuid)
      return
    }
    if (field && seed.type === 'checkbox' && eligible.length > 1) {
      field.destroy()
      out.groups.push({ anchor: eligible[0] })
    }
  },
  dropStalePart,
}

const createField = (candidate: GenericCandidate): BaseField => {
  switch (candidate.kind) {
    case 'combobox':
      return new GenericCombobox(candidate.element)
    case 'date':
      return new GenericDateGroup(candidate.element, candidate.group.parts, candidate.group.container)
    case 'text':
      return new GenericTextInput(candidate.element)
    case 'textarea':
      return new GenericTextarea(candidate.element)
    case 'select':
      return new GenericSelect(candidate.element)
    case 'ariaRadioGroup':
      return new GenericAriaRadioGroup(candidate.element)
    case 'ariaCheckbox':
      return new GenericAriaCheckbox(candidate.element)
    case 'yesNoToggle':
      return new GenericYesNoToggle(candidate.element)
    case 'radioGroup':
      return new GenericRadioGroup(candidate.element)
    case 'singleCheckbox':
      return new GenericCheckboxBoolean(candidate.element)
    case 'checkboxGroup':
      return new GenericCheckboxMulti(candidate.element)
    case 'contentEditable':
      return new GenericContentEditable(candidate.element)
    case 'file':
      return new GenericFileInput(candidate.element)
  }
}

export const RegisterInputs = (node: Node = document): void => {
  for (const candidate of genericCandidates(ensureRoot(node), domClaims, registryGroupHooks)) createField(candidate).init()
}

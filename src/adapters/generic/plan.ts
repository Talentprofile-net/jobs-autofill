import { isConcealedControl } from '~/core/concealment'
import { hasDisplayedAncestor } from '~/core/fileAttach'
import type { Claims } from '~/field/claims'
import { isVisible } from '~/field/fieldVisibility'
import { CV_FIELD_TYPE } from '~/resolver/cvFile'
import {
  ARIA_CHECKBOX_SELECTOR,
  ARIA_RADIO_GROUP_SELECTOR,
  ariaCheckboxName,
  ariaCheckboxQualifies,
  ariaRadioGroupName,
  ariaRadioGroupQualifies,
  ariaRadioGroupShown,
  isShown,
  toggleContainerOf,
  toggleName,
  toggleQualifies,
  toggleShown,
  YES_NO_TOGGLE_SELECTOR,
} from './ariaChoiceDom'
import { dateGroupFieldName, dateGroupFieldType, discoverDateGroups, type DateGroup } from './dateGroups'
import {
  COMBOBOX_SELECTOR,
  comboboxQualifies,
  CONTENT_EDITABLE_SELECTOR,
  isCandidateControl,
  isContentEditableLike,
  querySelectorAllInNode,
  TEXT_INPUT_SELECTOR,
} from './dom'
import { FILE_INPUT_SELECTOR, fileQuestionLabel, isDocumentFileInput } from './fileLabel'
import { groupFieldName, groupShown, isOperableOption, type ChoiceInput } from './groupParts'
import { discoverCheckboxGroups, discoverRadioGroups, type GroupHooks } from './groups'
import { resolveLabel } from './labelResolver'

type PlainKind = 'combobox' | 'text' | 'textarea' | 'select' | 'ariaRadioGroup' | 'ariaCheckbox' | 'yesNoToggle' | 'singleCheckbox' | 'contentEditable' | 'file'

export type GenericCandidate =
  | { kind: PlainKind; element: HTMLElement }
  | { kind: 'date'; element: HTMLInputElement; group: DateGroup }
  | { kind: 'radioGroup' | 'checkboxGroup'; element: ChoiceInput }

export type GenericDescription = {
  fieldName: string
  fieldType: string
  visible: boolean
  fillable: boolean
}

const SIMPLE_CONTROLS: ReadonlyArray<['text' | 'textarea' | 'select', string]> = [
  ['text', TEXT_INPUT_SELECTOR],
  ['textarea', 'textarea'],
  ['select', 'select'],
]

export function* genericCandidates(root: ParentNode, claims: Claims, hooks: GroupHooks): Generator<GenericCandidate> {
  for (const element of querySelectorAllInNode(root as Node, COMBOBOX_SELECTOR)) {
    if (claims.isInside(element) || !isVisible(element) || isConcealedControl(element) || !comboboxQualifies(element)) continue
    yield { element, kind: 'combobox' }
  }
  for (const group of discoverDateGroups(root, claims)) {
    if (claims.isInside(group.anchor)) continue
    yield { element: group.anchor, group, kind: 'date' }
  }
  for (const [kind, selector] of SIMPLE_CONTROLS) {
    for (const element of querySelectorAllInNode(root as Node, selector)) {
      if (isCandidateControl(element, claims)) yield { element, kind }
    }
  }
  for (const element of querySelectorAllInNode(root as Node, ARIA_RADIO_GROUP_SELECTOR)) {
    if (ariaRadioGroupQualifies(element, claims)) yield { element, kind: 'ariaRadioGroup' }
  }
  for (const element of querySelectorAllInNode(root as Node, ARIA_CHECKBOX_SELECTOR)) {
    if (ariaCheckboxQualifies(element, claims)) yield { element, kind: 'ariaCheckbox' }
  }
  const toggles = new Set<HTMLElement>()
  for (const button of querySelectorAllInNode(root as Node, YES_NO_TOGGLE_SELECTOR)) {
    const container = toggleContainerOf(button)
    if (container) toggles.add(container)
  }
  for (const element of toggles) {
    if (toggleQualifies(element, claims)) yield { element, kind: 'yesNoToggle' }
  }
  for (const group of discoverRadioGroups(root, claims, hooks)) {
    if (!claims.isInside(group.anchor)) yield { element: group.anchor, kind: 'radioGroup' }
  }
  const { groups, singles } = discoverCheckboxGroups(root, claims, hooks)
  for (const element of singles) {
    if (claims.isInside(element) || claims.isPart(element) || !isOperableOption(element)) continue
    yield { element, kind: 'singleCheckbox' }
  }
  for (const group of groups) {
    if (!claims.isInside(group.anchor)) yield { element: group.anchor, kind: 'checkboxGroup' }
  }
  for (const element of querySelectorAllInNode(root as Node, CONTENT_EDITABLE_SELECTOR)) {
    if (claims.isInside(element) || !isVisible(element) || isConcealedControl(element) || !isContentEditableLike(element)) continue
    yield { element, kind: 'contentEditable' }
  }
  for (const element of querySelectorAllInNode(root as Node, FILE_INPUT_SELECTOR)) {
    if (!claims.isInside(element) && isDocumentFileInput(element)) yield { element, kind: 'file' }
  }
}

export const selectFieldType = (element: HTMLElement): string =>
  'multiple' in element && element.multiple === true ? 'MultiSelect' : 'SimpleDropdown'

export const describeGenericCandidate = (candidate: GenericCandidate): GenericDescription => {
  const { element } = candidate
  const plain = (fieldType: string, visible = isVisible(element)): GenericDescription => ({ fieldName: resolveLabel(element), fieldType, fillable: true, visible })
  switch (candidate.kind) {
    case 'combobox':
      return plain('SimpleDropdown')
    case 'text':
    case 'textarea':
      return plain('TextInput')
    case 'select':
      return plain(selectFieldType(element))
    case 'singleCheckbox':
      return plain('SingleCheckbox', element instanceof HTMLInputElement && isOperableOption(element))
    case 'contentEditable':
      return { ...plain('ContentEditable'), fillable: false }
    case 'date':
      return { fieldName: dateGroupFieldName(candidate.group), fieldType: dateGroupFieldType(candidate.group), fillable: true, visible: isVisible(element) }
    case 'radioGroup':
      return { fieldName: groupFieldName(candidate.element), fieldType: 'RadioGroup', fillable: true, visible: groupShown(candidate.element) }
    case 'checkboxGroup':
      return { fieldName: groupFieldName(candidate.element), fieldType: 'MultiCheckbox', fillable: true, visible: groupShown(candidate.element) }
    case 'ariaRadioGroup':
      return { fieldName: ariaRadioGroupName(element), fieldType: 'RadioGroup', fillable: true, visible: ariaRadioGroupShown(element) }
    case 'ariaCheckbox':
      return { fieldName: ariaCheckboxName(element), fieldType: 'SingleCheckbox', fillable: true, visible: isShown(element) }
    case 'yesNoToggle':
      return { fieldName: toggleName(element), fieldType: 'RadioGroup', fillable: true, visible: toggleShown(element) }
    case 'file':
      return { fieldName: fileQuestionLabel(element), fieldType: CV_FIELD_TYPE, fillable: true, visible: hasDisplayedAncestor(element) }
  }
}

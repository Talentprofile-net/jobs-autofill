import { GenericTextInput } from './textInput'
import { GenericTextarea } from './textarea'
import { GenericSelect } from './select'
import { GenericCheckboxBoolean } from './checkboxBoolean'
import { GenericCheckboxMulti } from './checkboxMulti'
import { GenericRadioGroup } from './radioGroup'
import { GenericDateGroup } from './dateGroup'
import { GenericContentEditable } from './contentEditable'
import { isCandidateControl, querySelectorAllInNode } from './dom'
import { isConcealedControl } from '~/core/concealment'
import { isInsideRegistered, isVisible } from '~/field/baseField'
import { discoverRadioGroups, discoverCheckboxGroups } from './groups'
import { isGroupPart, isOperableOption } from './groupParts'
import { discoverDateGroups } from './dateGroups'
import { GenericCombobox } from './combobox'
import { GenericFileInput } from './fileInput'
import { GenericAriaCheckbox, GenericAriaRadioGroup, GenericYesNoToggle } from './ariaChoice'

const ensureRoot = (node: Node): ParentNode => {
  if (node instanceof Element) return node
  if (node === document) return document
  if (node instanceof DocumentFragment) return node
  if (node instanceof ShadowRoot) return node
  return document
}

const registerSimple = (
  root: ParentNode,
  selector: string,
  Ctor: new (el: HTMLElement) => { init: () => void },
): void => {
  const elements = querySelectorAllInNode(root as Node, selector)
  for (const el of elements) {
    if (!isCandidateControl(el)) continue
    new Ctor(el).init()
  }
}

const registerComboboxes = (root: ParentNode): void => {
  const elements = querySelectorAllInNode(root as Node, GenericCombobox.SELECTOR)
  for (const el of elements) {
    if (isInsideRegistered(el)) continue
    if (!isVisible(el)) continue
    if (isConcealedControl(el)) continue
    if (!GenericCombobox.qualifies(el)) continue
    new GenericCombobox(el).init()
  }
}

const registerDateGroups = (root: ParentNode): void => {
  const groups = discoverDateGroups(root)
  for (const group of groups) {
    if (isInsideRegistered(group.anchor)) continue
    new GenericDateGroup(group.anchor, group.parts, group.container).init()
  }
}

const registerAriaChoices = (root: ParentNode): void => {
  for (const group of querySelectorAllInNode(root as Node, GenericAriaRadioGroup.SELECTOR)) {
    if (GenericAriaRadioGroup.qualifies(group)) new GenericAriaRadioGroup(group).init()
  }
  for (const box of querySelectorAllInNode(root as Node, GenericAriaCheckbox.SELECTOR)) {
    if (GenericAriaCheckbox.qualifies(box)) new GenericAriaCheckbox(box).init()
  }
  const toggleContainers = new Set<HTMLElement>()
  for (const button of querySelectorAllInNode(root as Node, GenericYesNoToggle.SELECTOR)) {
    const container = GenericYesNoToggle.containerOf(button)
    if (container) toggleContainers.add(container)
  }
  for (const container of toggleContainers) {
    if (GenericYesNoToggle.qualifies(container)) new GenericYesNoToggle(container).init()
  }
}

const registerRadioGroups = (root: ParentNode): void => {
  const groups = discoverRadioGroups(root)
  for (const group of groups) {
    if (isInsideRegistered(group.anchor)) continue
    new GenericRadioGroup(group.anchor).init()
  }
}

const registerCheckboxes = (root: ParentNode): void => {
  const { singles, groups } = discoverCheckboxGroups(root)
  for (const cb of singles) {
    if (isInsideRegistered(cb) || isGroupPart(cb) || !isOperableOption(cb)) continue
    new GenericCheckboxBoolean(cb).init()
  }
  for (const group of groups) {
    if (isInsideRegistered(group.anchor)) continue
    new GenericCheckboxMulti(group.anchor).init()
  }
}

const registerContentEditables = (root: ParentNode): void => {
  const elements = querySelectorAllInNode(
    root as Node,
    GenericContentEditable.SELECTOR,
  )
  for (const el of elements) {
    if (isInsideRegistered(el)) continue
    if (!isVisible(el)) continue
    if (isConcealedControl(el)) continue
    if (!GenericContentEditable.qualifies(el)) continue
    new GenericContentEditable(el).init()
  }
}

const registerFileInputs = (root: ParentNode): void => {
  const elements = querySelectorAllInNode(root as Node, GenericFileInput.SELECTOR)
  for (const el of elements) {
    if (isInsideRegistered(el)) continue
    if (!GenericFileInput.qualifies(el)) continue
    new GenericFileInput(el).init()
  }
}

export const RegisterInputs = (node: Node = document): void => {
  const root = ensureRoot(node)
  registerComboboxes(root)
  registerDateGroups(root)
  registerSimple(root, GenericTextInput.SELECTOR, GenericTextInput)
  registerSimple(root, GenericTextarea.SELECTOR, GenericTextarea)
  registerSimple(root, GenericSelect.SELECTOR, GenericSelect)
  registerAriaChoices(root)
  registerRadioGroups(root)
  registerCheckboxes(root)
  registerContentEditables(root)
  registerFileInputs(root)
}
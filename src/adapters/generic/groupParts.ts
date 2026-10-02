import { FIELD_MARKER_ATTR } from '~/config'
import { PART_MARKER_ATTR } from '~/core/dateUtils'
import { hasConcealingAncestor, isOffCanvas } from '~/core/concealment'
import { querySelectorAllDeep, rootQueryScope } from '~/core/shadowDom'
import { isVisible } from '~/field/baseField'
import { blockText, containsField, resolveOptionLabel } from './labelResolver'

export type ChoiceInput = HTMLInputElement

export const explicitGroup = (input: Element): HTMLElement | null =>
  input.closest<HTMLElement>('fieldset, [role="group"], [role="radiogroup"]')

export const formOwner = (input: ChoiceInput): Node =>
  input.form ?? input.closest('form') ?? input.getRootNode()

const identity = (() => {
  const ids = new WeakMap<object, number>()
  let next = 0
  return (value: object): number => {
    let id = ids.get(value)
    if (id === undefined) {
      id = ++next
      ids.set(value, id)
    }
    return id
  }
})()

const OPTION_LABEL_MAX = 40

const hasLeadingHeading = (container: HTMLElement): boolean => {
  for (const child of Array.from(container.children)) {
    if (containsField(child)) return false
    if (blockText(child)) return true
  }
  return false
}

export const isDistinctNameGroup = (container: HTMLElement | null): boolean => {
  if (!container) return false
  const boxes = Array.from(container.querySelectorAll<ChoiceInput>('input[type="checkbox"]')).filter(
    (el) => explicitGroup(el) === container,
  )
  if (boxes.length < 2) return false
  const names = boxes.map((el) => el.name)
  if (names.some((n) => !n) || new Set(names).size !== names.length) return false
  if (!boxes.every((el) => {
    const label = resolveOptionLabel(el)
    return label.length > 0 && label.length <= OPTION_LABEL_MAX
  })) return false
  return hasLeadingHeading(container)
}

const groupName = (input: ChoiceInput): string =>
  input.type === 'checkbox' && isDistinctNameGroup(explicitGroup(input)) ? '*' : input.name

export const groupKeyOf = (input: ChoiceInput): string => {
  const container = explicitGroup(input)
  return `${input.type}:${identity(formOwner(input))}:${container ? identity(container) : 0}:${groupName(input)}`
}

export const containerToken = (input: ChoiceInput): number => {
  const container = explicitGroup(input)
  return container ? identity(container) : identity(formOwner(input))
}

export const associatedLabel = (el: ChoiceInput): HTMLElement | null => {
  const wrapping = el.closest('label')
  if (wrapping) return wrapping
  if (!el.id) return null
  return rootQueryScope(el).querySelector<HTMLElement>(`label[for="${CSS.escape(el.id)}"]`)
}

const shownInPage = (el: HTMLElement): boolean => isVisible(el) && !isOffCanvas(el)

export const isOperableOption = (el: ChoiceInput): boolean => {
  if (el.disabled || hasConcealingAncestor(el)) return false
  if (shownInPage(el)) return true
  const label = associatedLabel(el)
  if (!label || hasConcealingAncestor(label)) return false
  return shownInPage(label)
}

export const isEligibleOption = isOperableOption

export const activateOption = (el: ChoiceInput): void => {
  if (shownInPage(el)) {
    el.click()
    return
  }
  const label = associatedLabel(el)
  if (label && shownInPage(label)) label.click()
  else el.click()
}

export const sameKeyOptions = (seed: ChoiceInput): ChoiceInput[] => {
  const key = groupKeyOf(seed)
  const name = groupName(seed)
  return querySelectorAllDeep<ChoiceInput>(formOwner(seed), `input[type="${seed.type}"]`).filter(
    (el) => (name === '*' || el.name === seed.name) && groupKeyOf(el) === key,
  )
}

export const liveMembers = (anchor: ChoiceInput): ChoiceInput[] =>
  sameKeyOptions(anchor).filter((el) => el === anchor || isEligibleOption(el))

const anchorFor = (uuid: string): Element | null =>
  querySelectorAllDeep(document, `[${FIELD_MARKER_ATTR}="${CSS.escape(uuid)}"]`)[0] ?? null

export const dropStalePart = (el: Element): void => {
  const owner = el.getAttribute(PART_MARKER_ATTR)
  if (owner && !anchorFor(owner)) el.removeAttribute(PART_MARKER_ATTR)
}

export const claimParts = (anchor: ChoiceInput, uuid: string): void => {
  for (const member of liveMembers(anchor)) {
    if (member === anchor || member.hasAttribute(FIELD_MARKER_ATTR)) continue
    if (member.getAttribute(PART_MARKER_ATTR) !== uuid) member.setAttribute(PART_MARKER_ATTR, uuid)
  }
}

export const releaseParts = (uuid: string): void => {
  for (const el of querySelectorAllDeep(document, `[${PART_MARKER_ATTR}="${CSS.escape(uuid)}"]`)) {
    el.removeAttribute(PART_MARKER_ATTR)
  }
}

export const isGroupPart = (el: Element): boolean => el.hasAttribute(PART_MARKER_ATTR)

export const ownsMemberEvent = (anchor: ChoiceInput, target: Element): boolean =>
  liveMembers(anchor).some((member) => member === target || member.contains(target))

import { hasConcealingAncestor, isOffCanvas } from '~/core/concealment'
import { resolveLabelledByText } from '~/core/labelledBy'
import type { Claims } from '~/field/claims'
import { isVisible } from '~/field/fieldVisibility'
import { blockText, precedingSiblingText } from './labelResolver'

const CHECKED_STATES = new Set(['true', 'false', 'mixed'])

export const ARIA_RADIO_GROUP_SELECTOR = '[role="radiogroup"]'
export const ARIA_CHECKBOX_SELECTOR = '[role="checkbox"]'
export const YES_NO_TOGGLE_SELECTOR = 'button[aria-pressed]'

export const isShown = (el: HTMLElement): boolean => isVisible(el) && !isOffCanvas(el) && !hasConcealingAncestor(el)

const isDisabled = (el: Element): boolean =>
  el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled')

export const ownOptions = (group: HTMLElement): HTMLElement[] =>
  Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]')).filter(
    (option) => option.closest('[role="radiogroup"]') === group && option.tagName !== 'INPUT' && isShown(option) && !isDisabled(option),
  )

export const optionText = (option: HTMLElement): string => {
  const aria = option.getAttribute('aria-label')?.trim()
  if (aria) return aria
  const own = blockText(option)
  if (own) return own
  const ids = (option.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)
  return ids.length ? resolveLabelledByText(ids[ids.length - 1], option) : ''
}

export const isChecked = (el: HTMLElement): boolean => el.getAttribute('aria-checked') === 'true'

export const ariaRadioGroupQualifies = (group: HTMLElement, claims: Claims): boolean =>
  !claims.isInside(group) && !isDisabled(group) && isShown(group) && ownOptions(group).length >= 2

export const ariaRadioGroupName = (group: HTMLElement): string =>
  resolveLabelledByText(group.getAttribute('aria-labelledby'), group) ||
  group.getAttribute('aria-label')?.trim() ||
  precedingSiblingText(group)

export const ariaRadioGroupShown = (group: HTMLElement): boolean => isShown(group) && ownOptions(group).length >= 2

export const ariaCheckboxQualifies = (el: HTMLElement, claims: Claims): boolean =>
  el.tagName !== 'INPUT' && !claims.isInside(el) && !isDisabled(el) && CHECKED_STATES.has(el.getAttribute('aria-checked') ?? '') && isShown(el)

export const ariaCheckboxName = (el: HTMLElement): string =>
  el.getAttribute('aria-label')?.trim() ||
  resolveLabelledByText(el.getAttribute('aria-labelledby'), el) ||
  blockText(el) ||
  precedingSiblingText(el)

const YES = /^(yes|y)$/i
const NO = /^(no|n)$/i

export const toggleButtons = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.tagName === 'BUTTON' && child.hasAttribute('aria-pressed') && isShown(child) && !isDisabled(child),
  )

export const isPressed = (el: HTMLElement): boolean => el.getAttribute('aria-pressed') === 'true'

export const buttonText = (el: HTMLElement): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

export const toggleContainerOf = (button: HTMLElement): HTMLElement | null => button.parentElement

export const toggleQualifies = (container: HTMLElement, claims: Claims): boolean => {
  if (claims.isInside(container) || !isShown(container)) return false
  const texts = toggleButtons(container).map(buttonText)
  return texts.length === 2 && texts.some((t) => YES.test(t)) && texts.some((t) => NO.test(t))
}

export const toggleName = (container: HTMLElement): string =>
  resolveLabelledByText(container.getAttribute('aria-labelledby'), container) ||
  container.getAttribute('aria-label')?.trim() ||
  precedingSiblingText(container)

export const toggleShown = (container: HTMLElement): boolean => isShown(container) && toggleButtons(container).length === 2

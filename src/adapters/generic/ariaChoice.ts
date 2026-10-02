import fieldFillerQueue from '~/core/asyncQueue'
import { hasConcealingAncestor, isOffCanvas } from '~/core/concealment'
import { findOption } from '~/core/match'
import { resolveLabelledByText } from '~/core/labelledBy'
import { waitUntil } from '~/core/verify'
import { isInsideRegistered, isVisible } from '~/field/baseField'
import type { ProfileValue } from '~/field/types'
import { GenericBaseField } from './GenericBaseField'
import { blockText, precedingSiblingText } from './labelResolver'

const SETTLE_MS = 600
const POLL_MS = 25
const CHECKED_STATES = new Set(['true', 'false', 'mixed'])

const isShown = (el: HTMLElement): boolean => isVisible(el) && !isOffCanvas(el) && !hasConcealingAncestor(el)

const isDisabled = (el: Element): boolean =>
  el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled')

const ownOptions = (group: HTMLElement): HTMLElement[] =>
  Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]')).filter(
    (option) => option.closest('[role="radiogroup"]') === group && option.tagName !== 'INPUT' && isShown(option) && !isDisabled(option),
  )

const optionText = (option: HTMLElement): string => {
  const aria = option.getAttribute('aria-label')?.trim()
  if (aria) return aria
  const own = blockText(option)
  if (own) return own
  const ids = (option.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)
  return ids.length ? resolveLabelledByText(ids[ids.length - 1], option) : ''
}

const groupName = (group: HTMLElement): string =>
  resolveLabelledByText(group.getAttribute('aria-labelledby'), group) ||
  group.getAttribute('aria-label')?.trim() ||
  precedingSiblingText(group)

const isChecked = (el: HTMLElement): boolean => el.getAttribute('aria-checked') === 'true'

export class GenericAriaRadioGroup extends GenericBaseField {
  override fieldType = 'RadioGroup'

  static SELECTOR = '[role="radiogroup"]'

  static qualifies(group: HTMLElement): boolean {
    if (isInsideRegistered(group) || isDisabled(group) || !isShown(group)) return false
    return ownOptions(group).length >= 2
  }

  private get options(): HTMLElement[] {
    return ownOptions(this.element)
  }

  override get fieldName(): string {
    return groupName(this.element)
  }

  override isDisplayed(): boolean {
    return isShown(this.element) && this.options.length >= 2
  }

  currentValue(): string {
    const checked = this.options.find(isChecked)
    return checked ? optionText(checked) : ''
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice') return false
    const options = this.options.map((el) => ({ el, text: optionText(el) })).filter((o) => o.text)
    const candidates = [value.preferred, ...value.fallbacks]
    return fieldFillerQueue.enqueue(async () => {
      for (const candidate of candidates) {
        const match = findOption(options, (o) => o.text, candidate)
        if (!match) continue
        if (isChecked(match.el)) return true
        match.el.click()
        if (await waitUntil(() => isChecked(match.el), SETTLE_MS, POLL_MS)) return true
      }
      return false
    })
  }
}

export class GenericAriaCheckbox extends GenericBaseField {
  override fieldType = 'SingleCheckbox'

  static SELECTOR = '[role="checkbox"]'

  static qualifies(el: HTMLElement): boolean {
    if (el.tagName === 'INPUT' || isInsideRegistered(el) || isDisabled(el)) return false
    if (!CHECKED_STATES.has(el.getAttribute('aria-checked') ?? '')) return false
    return isShown(el)
  }

  override get fieldName(): string {
    return (
      this.element.getAttribute('aria-label')?.trim() ||
      resolveLabelledByText(this.element.getAttribute('aria-labelledby'), this.element) ||
      blockText(this.element) ||
      precedingSiblingText(this.element)
    )
  }

  override isDisplayed(): boolean {
    return isShown(this.element)
  }

  currentValue(): boolean {
    return isChecked(this.element)
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'boolean') return false
    if (isChecked(this.element) === value.value) return true
    return fieldFillerQueue.enqueue(async () => {
      this.element.click()
      return waitUntil(() => isChecked(this.element) === value.value, SETTLE_MS, POLL_MS)
    })
  }
}

const YES = /^(yes|y)$/i
const NO = /^(no|n)$/i

const toggleButtons = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.children).filter(
    (child): child is HTMLElement => child.tagName === 'BUTTON' && child.hasAttribute('aria-pressed') && isShown(child as HTMLElement) && !isDisabled(child),
  )

const isPressed = (el: HTMLElement): boolean => el.getAttribute('aria-pressed') === 'true'

const buttonText = (el: HTMLElement): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

export class GenericYesNoToggle extends GenericBaseField {
  override fieldType = 'RadioGroup'

  static SELECTOR = 'button[aria-pressed]'

  static containerOf(button: HTMLElement): HTMLElement | null {
    return button.parentElement
  }

  static qualifies(container: HTMLElement): boolean {
    if (isInsideRegistered(container) || !isShown(container)) return false
    const buttons = toggleButtons(container)
    if (buttons.length !== 2) return false
    const texts = buttons.map(buttonText)
    return texts.some((t) => YES.test(t)) && texts.some((t) => NO.test(t))
  }

  private get buttons(): HTMLElement[] {
    return toggleButtons(this.element)
  }

  override get fieldName(): string {
    return (
      resolveLabelledByText(this.element.getAttribute('aria-labelledby'), this.element) ||
      this.element.getAttribute('aria-label')?.trim() ||
      precedingSiblingText(this.element)
    )
  }

  override isDisplayed(): boolean {
    return isShown(this.element) && this.buttons.length === 2
  }

  currentValue(): string {
    const pressed = this.buttons.find(isPressed)
    return pressed ? buttonText(pressed) : ''
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice') return false
    const options = this.buttons.map((el) => ({ el, text: buttonText(el) }))
    const candidates = [value.preferred, ...value.fallbacks]
    return fieldFillerQueue.enqueue(async () => {
      for (const candidate of candidates) {
        const match = findOption(options, (o) => o.text, candidate)
        if (!match) continue
        if (isPressed(match.el)) return true
        match.el.click()
        if (await waitUntil(() => isPressed(match.el), SETTLE_MS, POLL_MS)) return true
      }
      return false
    })
  }
}

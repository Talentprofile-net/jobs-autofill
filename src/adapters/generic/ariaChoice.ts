import fieldFillerQueue from '~/core/asyncQueue'
import { findUniqueOption } from '~/core/match'
import { waitUntil } from '~/core/verify'
import { domClaims } from '~/field/claims'
import type { ProfileValue } from '~/field/types'
import { GenericBaseField } from './GenericBaseField'
import { activateControl } from '~/core/activate'
import {
  ARIA_CHECKBOX_SELECTOR,
  ARIA_RADIO_GROUP_SELECTOR,
  ariaCheckboxName,
  ariaCheckboxQualifies,
  ariaRadioGroupName,
  ariaRadioGroupQualifies,
  ariaRadioGroupShown,
  buttonText,
  isChecked,
  isPressed,
  isShown,
  optionText,
  ownOptions,
  toggleButtons,
  toggleContainerOf,
  toggleName,
  toggleQualifies,
  toggleShown,
  YES_NO_TOGGLE_SELECTOR,
} from './ariaChoiceDom'

const SETTLE_MS = 600
const POLL_MS = 25

export class GenericAriaRadioGroup extends GenericBaseField {
  override fieldType = 'RadioGroup'

  static SELECTOR = ARIA_RADIO_GROUP_SELECTOR

  static qualifies(group: HTMLElement): boolean {
    return ariaRadioGroupQualifies(group, domClaims)
  }

  private get options(): HTMLElement[] {
    return ownOptions(this.element)
  }

  override get fieldName(): string {
    return ariaRadioGroupName(this.element)
  }

  override isDisplayed(): boolean {
    return ariaRadioGroupShown(this.element)
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
        const match = findUniqueOption(options, (o) => o.text, candidate)
        if (!match) continue
        if (isChecked(match.el)) return true
        activateControl(match.el)
        if (await waitUntil(() => isChecked(match.el), SETTLE_MS, POLL_MS)) return true
      }
      return false
    })
  }
}

export class GenericAriaCheckbox extends GenericBaseField {
  override fieldType = 'SingleCheckbox'

  static SELECTOR = ARIA_CHECKBOX_SELECTOR

  static qualifies(el: HTMLElement): boolean {
    return ariaCheckboxQualifies(el, domClaims)
  }

  override get fieldName(): string {
    return ariaCheckboxName(this.element)
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
      activateControl(this.element)
      return waitUntil(() => isChecked(this.element) === value.value, SETTLE_MS, POLL_MS)
    })
  }
}

export class GenericYesNoToggle extends GenericBaseField {
  override fieldType = 'RadioGroup'

  static SELECTOR = YES_NO_TOGGLE_SELECTOR

  static containerOf(button: HTMLElement): HTMLElement | null {
    return toggleContainerOf(button)
  }

  static qualifies(container: HTMLElement): boolean {
    return toggleQualifies(container, domClaims)
  }

  private get buttons(): HTMLElement[] {
    return toggleButtons(this.element)
  }

  override get fieldName(): string {
    return toggleName(this.element)
  }

  override isDisplayed(): boolean {
    return toggleShown(this.element)
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
        const match = findUniqueOption(options, (o) => o.text, candidate)
        if (!match) continue
        if (isPressed(match.el)) return true
        activateControl(match.el)
        if (await waitUntil(() => isPressed(match.el), SETTLE_MS, POLL_MS)) return true
      }
      return false
    })
  }
}

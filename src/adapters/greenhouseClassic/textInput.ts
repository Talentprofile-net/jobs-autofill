import fieldFillerQueue from '~/core/asyncQueue'
import { getElement } from '~/core/getElements'
import { setNativeInputValue } from '~/core/reactProps'
import { writeVerifiedText } from '~/core/verify'
import { GreenhouseBaseInput } from './GreenhouseBaseInput'
import type { ProfileValue } from '~/field/types'
import { specs } from './specs'

const VERIFY_SETTLE_MS = 100

export class TextInput extends GreenhouseBaseInput {
  static XPATH = specs.textInput.xpath
  override fieldType = specs.textInput.fieldType
  protected override readonly spec = specs.textInput

  get inputElement(): HTMLInputElement | null {
    return getElement(this.element, ".//input[@type='text']") as HTMLInputElement | null
  }

  currentValue(): string {
    return this.inputElement?.value ?? ''
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'string') return false
    const input = this.inputElement
    if (!input) return false
    return fieldFillerQueue.enqueue(() =>
      writeVerifiedText(input, value.value, () => {
        input.focus()
        setNativeInputValue(input, value.value)
        input.dispatchEvent(new InputEvent('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        input.dispatchEvent(new Event('blur', { bubbles: true }))
      }, VERIFY_SETTLE_MS),
    )
  }
}
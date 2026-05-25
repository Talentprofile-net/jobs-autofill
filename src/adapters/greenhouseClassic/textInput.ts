import fieldFillerQueue from '~/core/asyncQueue'
import { getElement } from '~/core/getElements'
import { setNativeInputValue } from '~/core/reactProps'
import { GreenhouseBaseInput } from './GreenhouseBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'

const VERIFY_SETTLE_MS = 100

export class TextInput extends GreenhouseBaseInput {
  static XPATH = xpaths.TEXT_FIELD
  override fieldType = 'TextInput'

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
    let success = false
    await fieldFillerQueue.enqueue(async () => {
      input.focus()
      setNativeInputValue(input, value.value)
      input.dispatchEvent(new InputEvent('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      input.dispatchEvent(new Event('blur', { bubbles: true }))
      await new Promise((r) => setTimeout(r, VERIFY_SETTLE_MS))
      success = input.value === value.value
    })
    return success
  }
}
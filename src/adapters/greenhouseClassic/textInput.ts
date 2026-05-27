import fieldFillerQueue from '~/core/asyncQueue'
import { getElement } from '~/core/getElements'
import { setNativeInputValue } from '~/core/reactProps'
import { sleep } from '~/core/async'
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
    return fieldFillerQueue.enqueue(async () => {
      input.focus()
      setNativeInputValue(input, value.value)
      input.dispatchEvent(new InputEvent('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      input.dispatchEvent(new Event('blur', { bubbles: true }))
      await sleep(VERIFY_SETTLE_MS)
      return input.value === value.value
    })
  }
}
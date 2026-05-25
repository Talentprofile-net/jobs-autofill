import fieldFillerQueue from '~/core/asyncQueue'
import { setNativeInputValue } from '~/core/reactProps'
import { GenericBaseField } from './GenericBaseField'
import type { ProfileValue } from '~/field/types'

const VERIFY_SETTLE_MS = 150

export class GenericTextarea extends GenericBaseField {
  override fieldType = 'TextInput'

  static SELECTOR = 'textarea'

  get inputElement(): HTMLTextAreaElement {
    return this.element as HTMLTextAreaElement
  }

  currentValue(): string {
    return this.inputElement.value ?? ''
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'string') return false
    const input = this.inputElement
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
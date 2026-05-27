import fieldFillerQueue from '~/core/asyncQueue'
import { getElement } from '~/core/getElements'
import { setNativeInputValue } from '~/core/reactProps'
import { sleep } from '~/core/async'
import { GreenhouseBaseInput } from './GreenhouseBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'

const VERIFY_SETTLE_MS = 100

export class Textarea extends GreenhouseBaseInput {
  static XPATH = xpaths.TEXTAREA
  override fieldType = 'TextInput'

  get inputElement(): HTMLTextAreaElement | null {
    return getElement(this.element, './/textarea') as HTMLTextAreaElement | null
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
import fieldFillerQueue from '~/core/asyncQueue'
import { GenericBaseField } from './GenericBaseField'
import type { ProfileValue } from '~/field/types'

const VERIFY_SETTLE_MS = 100

export class GenericCheckboxBoolean extends GenericBaseField {
  override fieldType = 'SingleCheckbox'

  static SELECTOR = "input[type='checkbox']"

  get inputElement(): HTMLInputElement {
    return this.element as HTMLInputElement
  }

  currentValue(): boolean {
    return this.inputElement.checked
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'boolean') return false
    const input = this.inputElement
    if (input.checked === value.value) return true
    let success = false
    await fieldFillerQueue.enqueue(async () => {
      input.click()
      await new Promise((r) => setTimeout(r, VERIFY_SETTLE_MS))
      success = input.checked === value.value
    })
    return success
  }
}
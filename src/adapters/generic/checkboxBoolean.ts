import fieldFillerQueue from '~/core/asyncQueue'
import { sleep } from '~/core/async'
import { GenericBaseField } from './GenericBaseField'
import { activateOption, isOperableOption } from './groupParts'
import type { ProfileValue } from '~/field/types'

const VERIFY_SETTLE_MS = 100

export class GenericCheckboxBoolean extends GenericBaseField {
  override fieldType = 'SingleCheckbox'

  static SELECTOR = "input[type='checkbox']"

  get inputElement(): HTMLInputElement {
    return this.element as HTMLInputElement
  }

  override isDisplayed(): boolean {
    return isOperableOption(this.inputElement)
  }

  currentValue(): boolean {
    return this.inputElement.checked
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'boolean') return false
    const input = this.inputElement
    if (input.checked === value.value) return true
    return fieldFillerQueue.enqueue(async () => {
      activateOption(input)
      await sleep(VERIFY_SETTLE_MS)
      return input.checked === value.value
    })
  }
}
import fieldFillerQueue from '~/core/asyncQueue'
import { getElement } from '~/core/getElements'
import { fillReactTextInput } from '~/core/reactProps'
import { verifyTextValue } from '~/core/verify'
import { GreenhouseReactBaseInput } from './GreenhouseReactBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'

export class TextInput extends GreenhouseReactBaseInput {
  static XPATH = xpaths.TEXT_INPUT
  override fieldType = 'TextInput'

  get inputElement(): HTMLInputElement | null {
    return getElement(this.element, './/input') as HTMLInputElement | null
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
      fillReactTextInput(input, value.value, { eventName: 'onChange' })
      success = await verifyTextValue(input, value.value)
    })
    return success
  }
}
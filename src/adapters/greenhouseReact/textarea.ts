import fieldFillerQueue from '~/core/asyncQueue'
import { getElement } from '~/core/getElements'
import { fillReactTextInput } from '~/core/reactProps'
import { verifyTextValue } from '~/core/verify'
import { GreenhouseReactBaseInput } from './GreenhouseReactBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'

export class Textarea extends GreenhouseReactBaseInput {
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
      fillReactTextInput(input, value.value, { eventName: 'onChange' })
      return verifyTextValue(input, value.value)
    })
  }
}
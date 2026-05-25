import fieldFillerQueue from '~/core/asyncQueue'
import { getElement } from '~/core/getElements'
import { fillReactTextInput, getReactProps } from '~/core/reactProps'
import { WorkdayBaseInput } from './WorkdayBaseInput'
import type { ProfileValue } from '~/field/types'
import { xpaths } from './xpaths'

export class TextInput extends WorkdayBaseInput {
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
    await fieldFillerQueue.enqueue(async () => {
      fillReactTextInput(input, value.value, { eventName: 'onChange' })
      getReactProps(input)?.onBlur?.({ target: input })
    })
    return true
  }
}
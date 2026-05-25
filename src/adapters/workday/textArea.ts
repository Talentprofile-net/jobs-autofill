import fieldFillerQueue from '~/core/asyncQueue'
import { getElement } from '~/core/getElements'
import { fillReactTextInput } from '~/core/reactProps'
import { WorkdayBaseInput } from './WorkdayBaseInput'
import type { ProfileValue } from '~/field/types'
import { xpaths } from './xpaths'

export class TextArea extends WorkdayBaseInput {
  static XPATH = xpaths.TEXT_AREA
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
    await fieldFillerQueue.enqueue(async () => {
      fillReactTextInput(input, value.value, { eventName: 'onBlur' })
    })
    return true
  }
}
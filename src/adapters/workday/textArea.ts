import fieldFillerQueue from '~/core/asyncQueue'
import { getElement } from '~/core/getElements'
import { fillReactTextInput } from '~/core/reactProps'
import { writeVerifiedText } from '~/core/verify'
import { WorkdayBaseInput } from './WorkdayBaseInput'
import type { ProfileValue } from '~/field/types'
import { specs } from './specs'

export class TextArea extends WorkdayBaseInput {
  static XPATH = specs.textArea.xpath
  override fieldType = specs.textArea.fieldType
  protected override readonly spec = specs.textArea

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
    if (input.value === value.value) return true
    return fieldFillerQueue.enqueue(() =>
      writeVerifiedText(input, value.value, () => fillReactTextInput(input, value.value, { eventName: 'onBlur' })),
    )
  }
}
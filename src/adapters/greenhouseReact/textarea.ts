import fieldFillerQueue from '~/core/asyncQueue'
import { getElement } from '~/core/getElements'
import { fillReactTextInput } from '~/core/reactProps'
import { writeVerifiedText } from '~/core/verify'
import { GreenhouseReactBaseInput } from './GreenhouseReactBaseInput'
import type { ProfileValue } from '~/field/types'
import { specs } from './specs'

export class Textarea extends GreenhouseReactBaseInput {
  static XPATH = specs.textarea.xpath
  override fieldType = specs.textarea.fieldType
  protected override readonly spec = specs.textarea

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
    return fieldFillerQueue.enqueue(() =>
      writeVerifiedText(input, value.value, () => fillReactTextInput(input, value.value, { eventName: 'onChange' })),
    )
  }
}
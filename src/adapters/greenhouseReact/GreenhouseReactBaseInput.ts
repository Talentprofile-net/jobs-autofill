import { getElement } from '~/core/getElements'
import { BaseField } from '~/field/baseField'

export abstract class GreenhouseReactBaseInput extends BaseField {
  override get section(): string {
    const sectionEl = getElement(
      this.element,
      `ancestor::div[@jaf-section][1]`,
    )
    return sectionEl?.getAttribute('jaf-section') ?? ''
  }
}
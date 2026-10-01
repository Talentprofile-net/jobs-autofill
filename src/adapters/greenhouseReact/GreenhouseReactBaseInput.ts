import { getElement } from '~/core/getElements'
import { BaseField } from '~/field/baseField'
import type { WidgetPlacement } from '~/ui/picker/iconMount'

export abstract class GreenhouseReactBaseInput extends BaseField {
  protected override get widgetPlacement(): WidgetPlacement {
    return 'field'
  }

  override get section(): string {
    const sectionEl = getElement(
      this.element,
      `ancestor::div[@jaf-section][1]`,
    )
    return sectionEl?.getAttribute('jaf-section') ?? ''
  }
}
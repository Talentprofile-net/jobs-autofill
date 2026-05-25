import { BaseField } from '~/field/baseField'
import { resolveLabel } from './labelResolver'
import { inferSection } from './sections'
import type { PickerMode } from '~/field/types'

export abstract class GenericBaseField extends BaseField {
  override get fieldName(): string {
    return resolveLabel(this.element)
  }

  override get section(): string {
    return inferSection(this.element)
  }

  override get pickerMode(): PickerMode {
    return 'full'
  }

  protected override getWidgetAnchor(): HTMLElement | null {
    return this.element
  }
}
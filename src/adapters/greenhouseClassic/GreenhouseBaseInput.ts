import { BaseField } from '~/field/baseField'
import type { AtsFieldSpec } from '~/field/describe/atsSpec'
import type { WidgetPlacement } from '~/ui/picker/iconMount'
import { classicSection } from './sections'

export abstract class GreenhouseBaseInput extends BaseField {
  protected override get widgetPlacement(): WidgetPlacement {
    return 'field'
  }

  protected abstract readonly spec: AtsFieldSpec

  override get fieldName(): string {
    return this.spec.fieldName(this.element)
  }

  protected override canFill(): boolean {
    return this.spec.fillable(this.element)
  }

  override get section(): string {
    return classicSection(this.element)
  }
}
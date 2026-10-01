import { attachedFileNames, attachFile, hasDisplayedAncestor } from '~/core/fileAttach'
import { CV_FIELD_TYPE, isResumeFieldLabel } from '~/resolver/cvFile'
import type { CaptureRecord } from '~/field/baseField'
import type { ProfileValue } from '~/field/types'
import { GenericBaseField } from './GenericBaseField'
import { resolveLabel } from './labelResolver'

export class GenericFileInput extends GenericBaseField {
  override fieldType = CV_FIELD_TYPE

  static SELECTOR = 'input[type="file"]'

  static qualifies(el: HTMLElement): boolean {
    if (!(el instanceof HTMLInputElement) || el.disabled) return false
    return hasDisplayedAncestor(el) && isResumeFieldLabel(resolveLabel(el))
  }

  get inputElement(): HTMLInputElement {
    return this.element as HTMLInputElement
  }

  override isDisplayed(): boolean {
    return hasDisplayedAncestor(this.element)
  }

  protected override getWidgetAnchor(): HTMLElement | null {
    return null
  }

  override collectCapture(): CaptureRecord | null {
    return null
  }

  currentValue(): string {
    return attachedFileNames(this.inputElement)
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'file') return false
    return attachFile(this.inputElement, value)
  }
}

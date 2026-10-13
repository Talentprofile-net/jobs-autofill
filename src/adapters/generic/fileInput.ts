import { attachedFileNames, attachFile, hasDisplayedAncestor } from '~/core/fileAttach'
import { CV_FIELD_TYPE } from '~/resolver/cvFile'
import type { CaptureRecord } from '~/field/baseField'
import type { ProfileValue } from '~/field/types'
import { GenericBaseField } from './GenericBaseField'
import { FILE_INPUT_SELECTOR, fileQuestionLabel, isDocumentFileInput } from './fileLabel'

export class GenericFileInput extends GenericBaseField {
  override fieldType = CV_FIELD_TYPE

  static SELECTOR = FILE_INPUT_SELECTOR

  static qualifies(el: HTMLElement): boolean {
    return isDocumentFileInput(el)
  }

  get inputElement(): HTMLInputElement {
    return this.element as HTMLInputElement
  }

  override get fieldName(): string {
    return fileQuestionLabel(this.element)
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

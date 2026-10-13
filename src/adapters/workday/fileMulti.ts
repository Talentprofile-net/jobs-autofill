import { getElement, getElements } from '~/core/getElements'
import { WorkdayBaseInput } from './WorkdayBaseInput'
import type { ProfileValue } from '~/field/types'
import { specs } from './specs'

export class FileMulti extends WorkdayBaseInput {
  static XPATH = specs.fileMulti.xpath
  override fieldType = specs.fileMulti.fieldType
  protected override readonly spec = specs.fileMulti

  private get uploadedFileElements(): HTMLElement[] {
    return getElements(
      this.element,
      ".//div[@data-automation-id='file-upload-item']",
    )
  }

  currentValue(): string[] {
    return this.uploadedFileElements
      .map(
        (el) =>
          getElement(el, ".//div[@data-automation-id='file-upload-item-name']")
            ?.innerText ?? '',
      )
      .filter(Boolean)
  }

  async fill(_value: ProfileValue): Promise<boolean> {
    return false
  }
}
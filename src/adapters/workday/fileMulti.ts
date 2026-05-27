import { getElement, getElements } from '~/core/getElements'
import { WorkdayBaseInput } from './WorkdayBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'

export class FileMulti extends WorkdayBaseInput {
  static XPATH = xpaths.MULTI_FILE_UPLOAD
  override fieldType = 'MultiFileUpload'

  protected override canFill(): boolean {
    return false
  }

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
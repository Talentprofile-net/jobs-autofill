import { getElement } from '~/core/getElements'
import { GreenhouseBaseInput } from './GreenhouseBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'
import type { CaptureRecord } from '~/field/baseField'
import { attachFile } from '~/core/fileAttach'

export class File extends GreenhouseBaseInput {
  static XPATH = xpaths.SINGLE_FILE_UPLOAD
  override fieldType = 'SingleFileUpload'

  protected override canFill(): boolean {
    return this.fileInput !== null
  }

  private get fileInput(): HTMLInputElement | null {
    return this.element.querySelector<HTMLInputElement>('input[type="file"]')
  }

  override collectCapture(): CaptureRecord | null {
    return null
  }

  currentValue(): string {
    const xpath = [
      ".//div[@class='chosen']",
      "//span[contains(@id, '_filename')]",
    ].join('')
    return getElement(this.element, xpath)?.innerText ?? ''
  }

  async fill(value: ProfileValue): Promise<boolean> {
    const input = this.fileInput
    if (value.kind !== 'file' || !input) return false
    return attachFile(input, value)
  }
}
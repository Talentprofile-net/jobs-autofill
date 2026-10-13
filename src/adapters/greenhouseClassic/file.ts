import { getElement } from '~/core/getElements'
import { GreenhouseBaseInput } from './GreenhouseBaseInput'
import type { ProfileValue } from '~/field/types'
import type { CaptureRecord } from '~/field/baseField'
import { attachFile } from '~/core/fileAttach'
import { specs } from './specs'

export class File extends GreenhouseBaseInput {
  static XPATH = specs.file.xpath
  override fieldType = specs.file.fieldType
  protected override readonly spec = specs.file

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
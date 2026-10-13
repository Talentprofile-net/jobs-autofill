import { getElement } from '~/core/getElements'
import { GreenhouseReactBaseInput } from './GreenhouseReactBaseInput'
import type { ProfileValue } from '~/field/types'
import type { CaptureRecord } from '~/field/baseField'
import { attachFile } from '~/core/fileAttach'
import { specs } from './specs'

export class File extends GreenhouseReactBaseInput {
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
    return (
      getElement(
        this.element,
        `.//div[@class="file-upload__filename"]`,
      )?.innerText ?? ''
    )
  }

  async fill(value: ProfileValue): Promise<boolean> {
    const input = this.fileInput
    if (value.kind !== 'file' || !input) return false
    return attachFile(input, value)
  }
}
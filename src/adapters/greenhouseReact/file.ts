import { getElement } from '~/core/getElements'
import { GreenhouseReactBaseInput } from './GreenhouseReactBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'
import type { CaptureRecord } from '~/field/baseField'
import { attachFile } from '~/core/fileAttach'

export class File extends GreenhouseReactBaseInput {
  static XPATH = xpaths.FILE
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

  override get labelElement(): HTMLElement | null {
    return getElement(this.element, `.//div[contains(@class, "label")]`)
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
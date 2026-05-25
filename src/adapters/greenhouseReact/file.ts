import { getElement } from '~/core/getElements'
import { GreenhouseReactBaseInput } from './GreenhouseReactBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'

export class File extends GreenhouseReactBaseInput {
  static XPATH = xpaths.FILE
  override fieldType = 'SingleFileUpload'

  protected override canFill(): boolean {
    return false
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

  async fill(_value: ProfileValue): Promise<boolean> {
    return false
  }
}
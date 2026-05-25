import { getElement } from '~/core/getElements'
import { GreenhouseBaseInput } from './GreenhouseBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'

export class File extends GreenhouseBaseInput {
  static XPATH = xpaths.SINGLE_FILE_UPLOAD
  override fieldType = 'SingleFileUpload'

  protected override canFill(): boolean {
    return false
  }

  currentValue(): string {
    const xpath = [
      ".//div[@class='chosen']",
      "//span[contains(@id, '_filename')]",
    ].join('')
    return getElement(this.element, xpath)?.innerText ?? ''
  }

  async fill(_value: ProfileValue): Promise<boolean> {
    return false
  }
}
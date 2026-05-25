import { sleep } from '~/core/async'
import fieldFillerQueue from '~/core/asyncQueue'
import { getElement, getElements } from '~/core/getElements'
import { getReactProps } from '~/core/reactProps'
import { WorkdayBaseInput } from './WorkdayBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'

export class FileMulti extends WorkdayBaseInput {
  static XPATH = xpaths.MULTI_FILE_UPLOAD
  override fieldType = 'MultiFileUpload'

  protected override canFill(): boolean {
    return false
  }

  private get dropZoneElement(): HTMLElement | null {
    return getElement(
      this.element,
      ".//div[@data-automation-id='file-upload-drop-zone']",
    )
  }

  private get uploadedFileDeleteButtonElements(): HTMLElement[] {
    return getElements(
      this.element,
      ".//button[@data-automation-id='delete-file']",
    )
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

  protected override shouldOverwrite(_target: ProfileValue): boolean {
    return this.uploadedFileElements.length === 0
  }

  async uploadFile(file: File): Promise<void> {
    const dz = this.dropZoneElement
    if (!dz) return
    await fieldFillerQueue.enqueue(async () => {
      for (const btn of this.uploadedFileDeleteButtonElements) {
        btn.click()
      }
      await sleep(50)
      const reactProps = getReactProps(dz)
      reactProps?.onDrop?.({
        dataTransfer: { files: [file] },
        preventDefault: () => {},
        stopPropagation: () => {},
      })
    })
  }
}
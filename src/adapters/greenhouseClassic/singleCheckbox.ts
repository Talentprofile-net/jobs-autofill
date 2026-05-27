import fieldFillerQueue from '~/core/asyncQueue'
import { getElement } from '~/core/getElements'
import { sleep } from '~/core/async'
import { GreenhouseBaseInput } from './GreenhouseBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'

const VERIFY_SETTLE_MS = 80

export class SingleCheckbox extends GreenhouseBaseInput {
  static XPATH = xpaths.SINGLE_CHECKBOX
  override fieldType = 'SingleCheckbox'

  private get checkbox(): HTMLInputElement | null {
    return getElement(this.element, ".//input[@type='checkbox']") as HTMLInputElement | null
  }

  private get labelEl(): HTMLElement | null {
    return getElement(this.element, ".//label[.//input[@type='checkbox']]")
  }

  currentValue(): boolean {
    return this.checkbox?.checked ?? false
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'boolean') return false
    const cb = this.checkbox
    if (!cb) return false
    if (cb.checked === value.value) return true
    const label = this.labelEl
    return fieldFillerQueue.enqueue(async () => {
      if (label) label.click()
      else cb.click()
      await sleep(VERIFY_SETTLE_MS)
      return cb.checked === value.value
    })
  }
}
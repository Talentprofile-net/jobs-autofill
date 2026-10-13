import fieldFillerQueue from '~/core/asyncQueue'
import { getElement } from '~/core/getElements'
import { sleep } from '~/core/async'
import { GreenhouseBaseInput } from './GreenhouseBaseInput'
import type { ProfileValue } from '~/field/types'
import { activateControl } from '~/core/activate'
import { specs } from './specs'

const VERIFY_SETTLE_MS = 80

export class SingleCheckbox extends GreenhouseBaseInput {
  static XPATH = specs.singleCheckbox.xpath
  override fieldType = specs.singleCheckbox.fieldType
  protected override readonly spec = specs.singleCheckbox

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
      if (label) activateControl(label)
      else activateControl(cb)
      await sleep(VERIFY_SETTLE_MS)
      return cb.checked === value.value
    })
  }
}
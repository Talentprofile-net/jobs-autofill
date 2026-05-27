import fieldFillerQueue from '~/core/asyncQueue'
import { getElement } from '~/core/getElements'
import { sleep } from '~/core/async'
import { GreenhouseReactBaseInput } from './GreenhouseReactBaseInput'
import { xpaths } from './xpaths'
import { CheckboxWrapperContainer } from './checkboxWrapper'
import type { ProfileValue } from '~/field/types'

const VERIFY_SETTLE_MS = 80

export class CheckboxBoolean extends GreenhouseReactBaseInput {
  static XPATH = xpaths.CHECKBOX_BOOLEAN
  override fieldType = 'SingleCheckbox'

  override get labelElement(): HTMLElement | null {
    return getElement(this.element, `.//legend`)
  }

  private get checkbox(): CheckboxWrapperContainer | null {
    const el = getElement(this.element, `.//div[@class="checkbox__wrapper"]`)
    return el ? new CheckboxWrapperContainer(el) : null
  }

  currentValue(): boolean {
    return this.checkbox?.checked ?? false
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'boolean') return false
    const cb = this.checkbox
    if (!cb) return false
    if (cb.checked === value.value) return true
    return fieldFillerQueue.enqueue(async () => {
      if (value.value) cb.check()
      else cb.uncheck()
      await sleep(VERIFY_SETTLE_MS)
      return cb.checked === value.value
    })
  }
}
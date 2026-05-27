import fieldFillerQueue from '~/core/asyncQueue'
import { getElement, waitForElement } from '~/core/getElements'
import { WorkdayBaseInput } from './WorkdayBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'

export class BooleanCheckbox extends WorkdayBaseInput {
  static XPATH = xpaths.SINGLE_CHECKBOX
  override fieldType = 'SingleCheckbox'

  private get checkboxElement(): HTMLInputElement | null {
    return getElement(this.element, ".//input[@type='checkbox']") as HTMLInputElement | null
  }

  currentValue(): boolean {
    const cb = this.checkboxElement
    if (!cb) return false
    const aria = cb.getAttribute('aria-checked')
    if (aria === 'true') return true
    if (aria === 'false') return false
    return cb.checked
  }

  private currentStateXpath(expected: boolean): string {
    return [
      './/input',
      "[@type='checkbox']",
      `[@aria-checked='${expected}']`,
    ].join('')
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'boolean') return false
    const checkbox = this.checkboxElement
    if (!checkbox) return false
    if (this.currentValue() === value.value) return true

    return fieldFillerQueue.enqueue(async () => {
      const initial = this.currentValue()
      checkbox.click()
      await waitForElement(this.element, this.currentStateXpath(!initial), {
        observeAttributes: true,
        attributeFilter: ['aria-checked'],
        timeout: 1500,
      })
      return this.currentValue() === value.value
    })
  }
}
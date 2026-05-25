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
    return this.checkboxElement?.checked ?? false
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
    if (this.currentValue() === value.value) return false

    let success = false
    await fieldFillerQueue.enqueue(async () => {
      const initial = this.currentValue()
      checkbox.click()
      await waitForElement(this.element, this.currentStateXpath(!initial), {
        observeAttributes: true,
        attributeFilter: ['aria-checked'],
        timeout: 1500,
      })
      success = this.currentValue() === value.value
    })
    return success
  }
}
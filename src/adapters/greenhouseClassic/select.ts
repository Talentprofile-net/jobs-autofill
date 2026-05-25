import fieldFillerQueue from '~/core/asyncQueue'
import { getElement, getElements } from '~/core/getElements'
import { GreenhouseBaseInput } from './GreenhouseBaseInput'
import { xpaths } from './xpaths'
import { findOption } from '~/core/match'
import type { ProfileValue } from '~/field/types'

export class Select extends GreenhouseBaseInput {
  static XPATH = xpaths.BASIC_SELECT
  override fieldType = 'SimpleDropdown'

  get selectElement(): HTMLSelectElement | null {
    return getElement(this.element, './/select') as HTMLSelectElement | null
  }

  currentValue(): string {
    return this.selectElement?.selectedOptions[0]?.innerText ?? ''
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice') return false
    const select = this.selectElement
    if (!select) return false
    const candidates = [value.preferred, ...value.fallbacks]
    const options = getElements(select, './option') as HTMLOptionElement[]
    let filled = false
    await fieldFillerQueue.enqueue(async () => {
      for (const candidate of candidates) {
        const option = findOption(options, (o) => o.innerText, candidate)
        if (option) {
          select.selectedIndex = option.index
          select.dispatchEvent(new Event('change', { bubbles: true }))
          filled = true
          break
        }
      }
    })
    return filled
  }
}
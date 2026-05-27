import fieldFillerQueue from '~/core/asyncQueue'
import { getElement, getElements } from '~/core/getElements'
import { GreenhouseBaseInput } from './GreenhouseBaseInput'
import { xpaths } from './xpaths'
import { findOption, optionMatches, optionMatchesRelaxed } from '~/core/match'
import type { ProfileValue } from '~/field/types'

export class Select extends GreenhouseBaseInput {
  static XPATH = xpaths.BASIC_SELECT
  override fieldType = 'SimpleDropdown'

  get selectElement(): HTMLSelectElement | null {
    return getElement(this.element, './/select') as HTMLSelectElement | null
  }

  currentValue(): string {
    return this.selectElement?.selectedOptions[0]?.text ?? ''
  }

  private isSelected(candidate: string): boolean {
    const current = this.currentValue()
    if (!current) return false
    if (optionMatches(current, candidate)) return true
    return optionMatchesRelaxed(current, candidate)
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice') return false
    const select = this.selectElement
    if (!select) return false
    const candidates = [value.preferred, ...value.fallbacks]
    const options = Array.from(select.options)
    return fieldFillerQueue.enqueue(async () => {
      for (const candidate of candidates) {
        if (this.isSelected(candidate)) return true
        const option = findOption(options, (o) => o.text, candidate)
        if (!option) continue
        select.selectedIndex = option.index
        select.dispatchEvent(new Event('input', { bubbles: true }))
        select.dispatchEvent(new Event('change', { bubbles: true }))
        if (this.isSelected(candidate)) return true
      }
      return false
    })
  }
}
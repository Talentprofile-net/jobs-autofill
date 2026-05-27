import fieldFillerQueue from '~/core/asyncQueue'
import { getElement, getElements, waitForElement } from '~/core/getElements'
import { findOption, optionMatches, optionMatchesRelaxed } from '~/core/match'
import { setNativeInputValue } from '~/core/reactProps'
import { sleep } from '~/core/async'
import { GreenhouseBaseInput } from './GreenhouseBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'

const SELECTION_SETTLE_MS = 100

export class AddressSearchable extends GreenhouseBaseInput {
  static XPATH = xpaths.ADDRESS_SEARCH_FIELD
  override fieldType = 'SimpleDropdown'

  private get inputElement(): HTMLInputElement | null {
    return getElement(this.element, ".//input[@type='text']") as HTMLInputElement | null
  }

  private get autoCompleteElement(): HTMLElement | null {
    return getElement(this.element, './/auto-complete')
  }

  currentValue(): string {
    return this.autoCompleteElement?.getAttribute('value') ?? ''
  }

  private isSelected(candidate: string): boolean {
    const current = this.currentValue()
    if (!current) return false
    if (optionMatches(current, candidate)) return true
    return optionMatchesRelaxed(current, candidate)
  }

  private resetInput(input: HTMLInputElement, value: string): void {
    setNativeInputValue(input, value)
    input.dispatchEvent(new InputEvent('input', { bubbles: true }))
  }

  private async tryCandidate(
    input: HTMLInputElement,
    candidate: string,
  ): Promise<boolean> {
    this.resetInput(input, candidate)
    await sleep(100)
    await waitForElement(this.element, `.//auto-complete[@open]`, { timeout: 1500 })
    const items = getElements(this.element, `.//ul/li`)
    const match = findOption(items, (li) => li.innerText, candidate)
    if (!match) return false
    match.click()
    await sleep(SELECTION_SETTLE_MS)
    return this.isSelected(candidate)
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice') return false
    const candidates = [value.preferred, ...value.fallbacks]
    const input = this.inputElement
    if (!input) return false
    const originalValue = input.value

    return fieldFillerQueue.enqueue(async () => {
      let filled = false
      try {
        for (const candidate of candidates) {
          if (this.isSelected(candidate)) {
            filled = true
            return true
          }
        }
        for (const candidate of candidates) {
          if (await this.tryCandidate(input, candidate)) {
            filled = true
            return true
          }
          this.resetInput(input, '')
          await sleep(50)
        }
        return false
      } finally {
        if (!filled) this.resetInput(input, originalValue)
      }
    })
  }
}
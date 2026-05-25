import { sleep } from '~/core/async'
import fieldFillerQueue from '~/core/asyncQueue'
import { getElement, getElements, waitForElement } from '~/core/getElements'
import { findOption } from '~/core/match'
import { setNativeInputValue } from '~/core/reactProps'
import { GreenhouseBaseInput } from './GreenhouseBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'

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
    if (match) {
      match.click()
      return true
    }
    return false
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice') return false
    const candidates = [value.preferred, ...value.fallbacks]
    const input = this.inputElement
    if (!input) return false
    const originalValue = input.value

    let filled = false
    await fieldFillerQueue.enqueue(async () => {
      for (const candidate of candidates) {
        if (await this.tryCandidate(input, candidate)) {
          filled = true
          return
        }
        this.resetInput(input, '')
        await sleep(50)
      }
      this.resetInput(input, originalValue)
    })
    return filled
  }
}
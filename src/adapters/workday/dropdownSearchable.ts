import { sleep } from '~/core/async'
import fieldFillerQueue from '~/core/asyncQueue'
import { getElement, getElements, waitForElement } from '~/core/getElements'
import { scrollBack } from '~/core/scroll'
import { getReactProps, setNativeInputValue } from '~/core/reactProps'
import { findOption, optionMatches } from '~/core/match'
import { createKeyboardEvent } from '~/core/events'
import { WorkdayBaseInput } from './WorkdayBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'

const PRE_FILL_SETTLE_MS = 200
const DROPDOWN_WAIT_MS = 1000
const SELECTION_SETTLE_MS = 100

export class DropdownSearchable extends WorkdayBaseInput {
  static XPATH = xpaths.SEARCHABLE_SINGLE_DROPDOWN
  override fieldType = 'SimpleDropdown'

  private get inputElement(): HTMLInputElement | null {
    return getElement(this.element, './/input') as HTMLInputElement | null
  }

  private get multiSelectContainerElement(): HTMLElement | null {
    return getElement(
      this.element,
      ".//div[@data-automation-id='multiSelectContainer']",
    )
  }

  private get dropdownId(): string | null {
    return this.multiSelectContainerElement?.getAttribute('id') ?? null
  }

  private async dropdownElement(): Promise<HTMLElement | null> {
    const id = this.dropdownId
    if (!id) return null
    const xpath = [
      './/body',
      "/div[@data-automation-widget='wd-popup']",
      `[//div[@data-associated-widget='${id}']]`,
    ].join('')
    return waitForElement(document, xpath, { timeout: DROPDOWN_WAIT_MS })
  }

  private async closeDropdown(): Promise<void> {
    const input = this.inputElement
    if (!input) return
    input.dispatchEvent(createKeyboardEvent('keydown', 'Escape'))
    input.dispatchEvent(createKeyboardEvent('keyup', 'Escape'))
    input.blur()
  }

  private get selectedItemElement(): HTMLElement | null {
    return getElement(
      this.element,
      ".//ul[@data-automation-id='selectedItemList']//li",
    )
  }

  currentValue(): string {
    return this.selectedItemElement?.textContent ?? ''
  }

  private resetInput(input: HTMLInputElement): void {
    setNativeInputValue(input, '')
    input.dispatchEvent(new InputEvent('input', { bubbles: true }))
  }

  private async findMatchingOption(candidate: string): Promise<HTMLElement | null> {
    const dropdownEl = await this.dropdownElement()
    if (!dropdownEl) return null
    const options = getElements(dropdownEl, ".//div[@data-automation-id='promptOption']")
    return findOption(options, (o) => o.innerText, candidate)
  }

  private isCandidateSelected(candidate: string): boolean {
    const el = this.selectedItemElement
    if (!el) return false
    return optionMatches(el.innerText, candidate)
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice') return false
    const candidates = [value.preferred, ...value.fallbacks]
    const input = this.inputElement
    if (!input) return false

    let filled = false
    await fieldFillerQueue.enqueue(async () => {
      await scrollBack(
        async () => {
          try {
            await sleep(PRE_FILL_SETTLE_MS)
            for (const candidate of candidates) {
              if (this.isCandidateSelected(candidate)) {
                filled = true
                return
              }

              this.resetInput(input)
              setNativeInputValue(input, candidate)
              input.dispatchEvent(new InputEvent('input', { bubbles: true }))
              getReactProps(input)?.onKeyDown?.({
                key: 'Tab',
                target: { value: candidate },
              })

              await sleep(SELECTION_SETTLE_MS)
              if (this.isCandidateSelected(candidate)) {
                filled = true
                return
              }

              const match = await this.findMatchingOption(candidate)
              if (match) {
                match.click()
                await sleep(SELECTION_SETTLE_MS)
                if (this.isCandidateSelected(candidate)) {
                  filled = true
                  return
                }
              }
            }
          } finally {
            await this.closeDropdown()
          }
        },
        { element: this.element },
      )
    })
    return filled
  }
}
import { sleep } from '~/core/async'
import fieldFillerQueue from '~/core/asyncQueue'
import { getElement, getElements, waitForElement } from '~/core/getElements'
import { scrollBack } from '~/core/scroll'
import { getReactProps } from '~/core/reactProps'
import { GreenhouseReactBaseInput } from './GreenhouseReactBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'
import { findOption, optionMatches, optionMatchesRelaxed } from '~/core/match'

const VERIFY_SETTLE_MS = 150

export class DropdownSearchable extends GreenhouseReactBaseInput {
  static XPATH = xpaths.DROPDOWN_SEARCHABLE
  override fieldType = 'SimpleDropdown'

  private get menuOpenTriggerDiv(): HTMLElement | null {
    return getElement(
      this.element,
      `.//div[starts-with(@class, "select-shell")]/div[not(@*)]`,
    )
  }

  private get searchInput(): HTMLInputElement | null {
    return getElement(
      this.element,
      `.//input[@class="select__input"]`,
    ) as HTMLInputElement | null
  }

  private get selectedValueElement(): HTMLElement | null {
    return getElement(
      this.element,
      `.//div[starts-with(@class, "select__single-value")]`,
    )
  }

  currentValue(): string {
    return this.selectedValueElement?.innerText ?? ''
  }

  private openDropdown(): void {
    const trigger = this.menuOpenTriggerDiv
    if (!trigger) return
    getReactProps(trigger)?.onMouseUp?.({ defaultPrevented: false })
  }

  private async waitForDropdown(): Promise<HTMLElement | null> {
    return waitForElement(
      this.element,
      `.//div[starts-with(@class, "select__menu")]`,
      { timeout: 300 },
    )
  }

  private async getVisibleChoices(): Promise<HTMLElement[]> {
    const dd = await this.waitForDropdown()
    if (!dd) return []
    return getElements(dd, `.//div[starts-with(@class, "select__option")]`)
  }

  private typeIntoSearch(value: string): void {
    const input = this.searchInput
    if (!input) return
    input.value = value
    getReactProps(input)?.onChange?.({ currentTarget: input })
  }

  private async findInVisible(candidate: string): Promise<HTMLElement | null> {
    const choices = await this.getVisibleChoices()
    return findOption(choices, (c) => c.innerText, candidate)
  }

  private async findViaSearch(candidate: string): Promise<HTMLElement | null> {
    this.typeIntoSearch(candidate)
    const dd = await this.waitForDropdown()
    if (!dd) return null
    const options = getElements(dd, `.//div[starts-with(@class, "select__option")]`)
    return findOption(options, (o) => o.innerText, candidate)
  }

  private blurInput(): void {
    const input = this.searchInput
    if (input) getReactProps(input)?.onBlur?.()
  }

  private isCandidateSelected(candidate: string): boolean {
    const current = this.currentValue()
    if (!current) return false
    if (optionMatches(current, candidate)) return true
    return optionMatchesRelaxed(current, candidate)
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice') return false
    const candidates = [value.preferred, ...value.fallbacks]

    let filled = false
    await fieldFillerQueue.enqueue(async () => {
      await scrollBack(
        async () => {
          this.openDropdown()

          for (const candidate of candidates) {
            let match = await this.findInVisible(candidate)
            if (!match) match = await this.findViaSearch(candidate)
            if (match) {
              match.click()
              await sleep(VERIFY_SETTLE_MS)
              this.blurInput()
              if (this.isCandidateSelected(candidate)) {
                filled = true
                return
              }
            }
          }

          this.typeIntoSearch('')
          this.blurInput()
        },
        { element: this.element },
      )
    })
    return filled
  }
}
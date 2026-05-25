import fieldFillerQueue from '~/core/asyncQueue'
import { getElement, getElements, waitForElement } from '~/core/getElements'
import { scrollBack } from '~/core/scroll'
import { getReactProps } from '~/core/reactProps'
import { GreenhouseReactBaseInput } from './GreenhouseReactBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'
import { findOption } from '~/core/match'

const MENU_WAIT_TIMEOUT_MS = 500

export class AddressSearchable extends GreenhouseReactBaseInput {
  static XPATH = xpaths.ADDRESS_SEARCHABLE
  override fieldType = 'SimpleDropdown'

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

  private get menuOpenTriggerDiv(): HTMLElement | null {
    return getElement(
      this.element,
      `.//div[starts-with(@class, "select-shell")]/div[not(@*)]`,
    )
  }

  currentValue(): string {
    return this.selectedValueElement?.innerText ?? ''
  }

  private openDropdown(): void {
    const trigger = this.menuOpenTriggerDiv
    if (!trigger) return
    getReactProps(trigger)?.onMouseUp?.({
      defaultPrevented: false,
      preventDefault: () => {},
      stopPropagation: () => {},
    })
  }

  private async waitForMenu(): Promise<HTMLElement | null> {
    return waitForElement(
      this.element,
      `.//div[starts-with(@class, "select__menu")]`,
      { timeout: MENU_WAIT_TIMEOUT_MS },
    )
  }

  private typeIntoSearch(value: string): void {
    const input = this.searchInput
    if (!input) return
    input.value = value
    getReactProps(input)?.onChange?.({
      currentTarget: input,
      target: input,
      preventDefault: () => {},
      stopPropagation: () => {},
    })
  }

  private async findMenuOption(candidate: string): Promise<HTMLElement | null> {
    const dd = await this.waitForMenu()
    if (!dd) return null
    const options = getElements(dd, `.//div[starts-with(@class, "select__option")]`)
    return findOption(options, (o) => o.innerText, candidate)
  }

  private async searchAndFind(candidate: string): Promise<HTMLElement | null> {
    this.typeIntoSearch(candidate)
    return this.findMenuOption(candidate)
  }

  private blurInput(): void {
    const input = this.searchInput
    if (input) {
      getReactProps(input)?.onBlur?.({
        target: input,
        preventDefault: () => {},
        stopPropagation: () => {},
      })
    }
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice') return false
    const candidates = [value.preferred, ...value.fallbacks]
    const input = this.searchInput
    if (!input) return false

    let filled = false
    await fieldFillerQueue.enqueue(async () => {
      await scrollBack(
        async () => {
          this.openDropdown()

          for (const candidate of candidates) {
            const match = await this.searchAndFind(candidate)
            if (match) {
              match.click()
              this.blurInput()
              filled = true
              return
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
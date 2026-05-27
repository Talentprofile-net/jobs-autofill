import fieldFillerQueue from '~/core/asyncQueue'
import { getElement, getElements, waitForElement } from '~/core/getElements'
import { scrollBack } from '~/core/scroll'
import { getReactProps } from '~/core/reactProps'
import { sleep, verifySelection } from '~/core/verify'
import { GreenhouseReactBaseInput } from './GreenhouseReactBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'
import { findOption } from '~/core/match'

const MENU_WAIT_TIMEOUT_MS = 500
const SELECTION_SETTLE_MS = 150

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
    const reactProps = getReactProps(trigger)
    if (reactProps?.onMouseUp) {
      reactProps.onMouseUp({
        defaultPrevented: false,
        preventDefault: () => {},
        stopPropagation: () => {},
      })
    } else {
      trigger.click()
    }
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
    const reactProps = getReactProps(input)
    if (reactProps?.onChange) {
      reactProps.onChange({
        currentTarget: input,
        target: input,
        preventDefault: () => {},
        stopPropagation: () => {},
      })
    } else {
      input.dispatchEvent(new InputEvent('input', { bubbles: true }))
    }
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
    if (!input) return
    const reactProps = getReactProps(input)
    if (reactProps?.onBlur) {
      reactProps.onBlur({
        target: input,
        preventDefault: () => {},
        stopPropagation: () => {},
      })
    } else {
      input.blur()
    }
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice') return false
    const candidates = [value.preferred, ...value.fallbacks]
    const input = this.searchInput
    if (!input) return false

    return fieldFillerQueue.enqueue(async () => {
      return await scrollBack(
        async () => {
          for (const candidate of candidates) {
            if (await verifySelection(() => this.currentValue(), candidate, 0)) {
              return true
            }
          }

          let filled = false
          try {
            this.openDropdown()
            for (const candidate of candidates) {
              const match = await this.searchAndFind(candidate)
              if (!match) continue
              match.click()
              await sleep(SELECTION_SETTLE_MS)
              if (
                await verifySelection(() => this.currentValue(), candidate, 0)
              ) {
                filled = true
                return true
              }
            }
            return false
          } finally {
            if (!filled) this.typeIntoSearch('')
            this.blurInput()
          }
        },
        { element: this.element },
      )
    })
  }
}
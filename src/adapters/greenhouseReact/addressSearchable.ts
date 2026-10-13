import fieldFillerQueue from '~/core/asyncQueue'
import { getElement, getElements, waitForElement } from '~/core/getElements'
import { scrollBack } from '~/core/scroll'
import { getReactProps } from '~/core/reactProps'
import { sleep, verifySelection } from '~/core/verify'
import { GreenhouseReactBaseInput } from './GreenhouseReactBaseInput'
import type { ProfileValue } from '~/field/types'
import { findUniqueOption } from '~/core/match'
import { activateControl } from '~/core/activate'
import { specs } from './specs'

const MENU_WAIT_TIMEOUT_MS = 500
const SELECTION_SETTLE_MS = 150
const OPTIONS_WAIT_TIMEOUT_MS = 4000
const OPTIONS_POLL_MS = 150

export class AddressSearchable extends GreenhouseReactBaseInput {
  static XPATH = specs.addressSearchable.xpath
  override fieldType = specs.addressSearchable.fieldType
  protected override readonly spec = specs.addressSearchable

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
      activateControl(trigger)
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
    const deadline = Date.now() + OPTIONS_WAIT_TIMEOUT_MS
    for (;;) {
      const dd = await this.waitForMenu()
      const options = dd ? getElements(dd, `.//div[starts-with(@class, "select__option")]`) : []
      if (options.length > 0 || Date.now() >= deadline) {
        return findUniqueOption(options, (o) => o.innerText, candidate)
      }
      await sleep(OPTIONS_POLL_MS)
    }
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
              activateControl(match)
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
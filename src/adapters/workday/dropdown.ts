import { sleep } from '~/core/async'
import fieldFillerQueue from '~/core/asyncQueue'
import { getElement, getElements, waitForElement } from '~/core/getElements'
import { scrollBack } from '~/core/scroll'
import { getReactProps } from '~/core/reactProps'
import { findOption } from '~/core/match'
import { WorkdayBaseInput } from './WorkdayBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'

export class Dropdown extends WorkdayBaseInput {
  static XPATH = xpaths.SIMPLE_DROPDOWN
  override fieldType = 'SimpleDropdown'

  private get buttonElement(): HTMLElement | null {
    return getElement(this.element, './/button[@aria-haspopup="listbox"]')
  }

  currentValue(): string {
    return this.buttonElement?.innerText ?? ''
  }

  private get dropdownIsOpen(): boolean {
    return this.buttonElement?.getAttribute('aria-expanded') === 'true'
  }

  private get dropdownId(): string | null {
    return this.buttonElement?.getAttribute('aria-controls') ?? null
  }

  private openDropdown(): void {
    if (!this.dropdownIsOpen) this.buttonElement?.click()
  }

  private closeDropdown(): void {
    if (this.dropdownIsOpen) this.buttonElement?.click()
  }

  private async dropdownElement(): Promise<HTMLElement | null> {
    const id = this.dropdownId
    if (!id || !this.dropdownIsOpen) return null
    return waitForElement(document, `.//body//ul[@id='${id}']`)
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice') return false
    const candidates = [value.preferred, ...value.fallbacks]
    let filled = false
    await fieldFillerQueue.enqueue(async () => {
      await scrollBack(
        async () => {
          this.openDropdown()
          await sleep(50)
          const dropdownEl = await this.dropdownElement()
          if (!dropdownEl) {
            this.closeDropdown()
            return
          }
          const items = getElements(dropdownEl, './/li[.//div]')
          const itemEntries = items.map((li) => ({
            li,
            text: getElement(li, './div')?.innerText ?? '',
          }))
          for (const candidate of candidates) {
            const match = findOption(itemEntries, (e) => e.text, candidate)
            if (match) {
              getReactProps(match.li)?.onClick?.({ preventDefault: () => {} })
              this.closeDropdown()
              filled = true
              return
            }
          }
          this.closeDropdown()
        },
        { element: this.element },
      )
    })
    return filled
  }
}
import { sleep } from '~/core/async'
import fieldFillerQueue from '~/core/asyncQueue'
import { getElement, getElements, waitForElement } from '~/core/getElements'
import { scrollBack } from '~/core/scroll'
import { getReactProps } from '~/core/reactProps'
import { findUniqueOption, xpathLiteral } from '~/core/match'
import { verifySelection } from '~/core/verify'
import { WorkdayBaseInput } from './WorkdayBaseInput'
import type { ProfileValue } from '~/field/types'
import { activateControl } from '~/core/activate'
import { specs } from './specs'

const SELECTION_SETTLE_MS = 150

export class Dropdown extends WorkdayBaseInput {
  static XPATH = specs.dropdown.xpath
  override fieldType = specs.dropdown.fieldType
  protected override readonly spec = specs.dropdown

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
    if (!this.dropdownIsOpen) activateControl(this.buttonElement)
  }

  private closeDropdown(): void {
    if (this.dropdownIsOpen) activateControl(this.buttonElement)
  }

  private async dropdownElement(): Promise<HTMLElement | null> {
    const id = this.dropdownId
    if (!id || !this.dropdownIsOpen) return null
    const idLiteral = xpathLiteral(id)
    return waitForElement(document, `.//body//ul[@id=${idLiteral}]`)
  }

  private selectListItem(li: HTMLElement): void {
    const reactProps = getReactProps(li)
    if (reactProps?.onClick) {
      reactProps.onClick({ preventDefault: () => {} })
    } else {
      activateControl(li)
    }
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice') return false
    const candidates = [value.preferred, ...value.fallbacks]
    return fieldFillerQueue.enqueue(async () => {
      return await scrollBack(
        async () => {
          for (const candidate of candidates) {
            if (await verifySelection(() => this.currentValue(), candidate, 0)) {
              return true
            }
          }

          try {
            this.openDropdown()
            await sleep(50)
            const dropdownEl = await this.dropdownElement()
            if (!dropdownEl) return false

            const items = getElements(dropdownEl, './/li[.//div]')
            const itemEntries = items.map((li) => ({
              li,
              text: getElement(li, './div')?.innerText ?? '',
            }))

            for (const candidate of candidates) {
              const match = findUniqueOption(itemEntries, (e) => e.text, candidate)
              if (!match) continue
              this.selectListItem(match.li)
              await sleep(SELECTION_SETTLE_MS)
              if (
                await verifySelection(() => this.currentValue(), candidate, 0)
              ) {
                return true
              }
            }
            return false
          } finally {
            this.closeDropdown()
          }
        },
        { element: this.element },
      )
    })
  }
}
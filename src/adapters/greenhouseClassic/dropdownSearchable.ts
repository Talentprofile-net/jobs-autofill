import fieldFillerQueue from '~/core/asyncQueue'
import { getElement, getElements, waitForElement } from '~/core/getElements'
import { setNativeInputValue } from '~/core/reactProps'
import { optionMatches, optionMatchesRelaxed, xpathLiteral } from '~/core/match'
import { sleep, verifySelection } from '~/core/verify'
import { GreenhouseBaseInput } from './GreenhouseBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'

const SELECTION_SETTLE_MS = 100

export class DropdownSearchable extends GreenhouseBaseInput {
  static XPATH = xpaths.DROPDOWN_SEARCHABLE
  override fieldType = 'SimpleDropdown'

  private get select2ContainerElement(): HTMLElement | null {
    return getElement(
      this.element,
      ".//div[contains(@class, 'select2-container')]",
    )
  }

  private get select2ContainerAElement(): HTMLElement | null {
    const c = this.select2ContainerElement
    return c ? getElement(c, './/a') : null
  }

  private get dropdownIsOpen(): boolean {
    return this.select2ContainerElement?.classList.contains(
      'select2-dropdown-open',
    ) ?? false
  }

  private toggleDropdown(): void {
    this.select2ContainerAElement?.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true }),
    )
  }

  private get dropdownId(): string | null {
    const c = this.select2ContainerElement
    return c ? getElement(c, './label')?.getAttribute('for') ?? null : null
  }

  private get dropdownElement(): HTMLElement | null {
    const id = this.dropdownId
    if (!id) return null
    const labelFor = xpathLiteral(`${id}_search`)
    const xpath = [
      ".//div[contains(@class, 'select2-drop-active')]",
      `[.//label[@for=${labelFor}]]`,
    ].join('')
    return getElement(document, xpath)
  }

  currentValue(): string {
    return this.select2ContainerAElement?.innerText ?? ''
  }

  private resetSearchInput(searchInput: HTMLInputElement): void {
    setNativeInputValue(searchInput, '')
    searchInput.dispatchEvent(new InputEvent('input', { bubbles: true }))
  }

  private async performSearch(
    dropdownEl: HTMLElement,
    value: string,
  ): Promise<HTMLElement | null> {
    const searchInput = getElement(
      dropdownEl,
      `.//div[@class="select2-search"]/input`,
    ) as HTMLInputElement | null
    if (!searchInput) return null
    if (searchInput.value !== '') this.resetSearchInput(searchInput)
    const resultsXpath = [
      `.//ul`,
      `[not(./li[starts-with(text(),"Searching")])]`,
    ].join('')
    const resultsPromise = waitForElement(dropdownEl, resultsXpath, {
      onlyNew: true,
      timeout: 600,
    })
    setNativeInputValue(searchInput, value)
    searchInput.dispatchEvent(new InputEvent('input', { bubbles: true }))
    const results = await resultsPromise
    if (!results) return null
    return (
      getElements(results, `./li`).find((el) =>
        optionMatches(el.innerText, value),
      ) ??
      getElements(results, `./li`).find((el) =>
        optionMatchesRelaxed(el.innerText, value),
      ) ??
      null
    )
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice') return false
    const candidates = [value.preferred, ...value.fallbacks]
    return fieldFillerQueue.enqueue(async () => {
      for (const candidate of candidates) {
        if (await verifySelection(() => this.currentValue(), candidate, 0)) {
          return true
        }
      }

      try {
        for (const candidate of candidates) {
          if (!this.dropdownIsOpen) this.toggleDropdown()
          const dropdownEl = this.dropdownElement
          if (!dropdownEl) continue
          const match = await this.performSearch(dropdownEl, candidate)
          if (!match) continue
          match.dispatchEvent(
            new Event('mouseup', { bubbles: true, cancelable: true }),
          )
          await sleep(SELECTION_SETTLE_MS)
          if (await verifySelection(() => this.currentValue(), candidate, 0)) {
            return true
          }
        }
        return false
      } finally {
        if (this.dropdownIsOpen) this.toggleDropdown()
      }
    })
  }
}
import fieldFillerQueue from '~/core/asyncQueue'
import { getElement, getElements, waitForElement } from '~/core/getElements'
import { optionMatches, xpathLiteral } from '~/core/match'
import { GreenhouseBaseInput } from './GreenhouseBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'

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
    this.select2ContainerAElement?.dispatchEvent(new MouseEvent('mousedown'))
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
    searchInput.value = ''
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
    this.resetSearchInput(searchInput)
    const resultsXpath = [
      `.//ul`,
      `[not(./li[starts-with(text(),"Searching")])]`,
    ].join('')
    const resultsPromise = waitForElement(dropdownEl, resultsXpath, {
      onlyNew: true,
      timeout: 600,
    })
    searchInput.value = value
    searchInput.dispatchEvent(new InputEvent('input', { bubbles: true }))
    const results = await resultsPromise
    if (!results) return null
    return getElements(results, `./li`).find((el) => optionMatches(el.innerText, value)) ?? null
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice') return false
    const candidates = [value.preferred, ...value.fallbacks]
    let filled = false
    await fieldFillerQueue.enqueue(async () => {
      try {
        for (const candidate of candidates) {
          if (!this.dropdownIsOpen) this.toggleDropdown()
          const dropdownEl = this.dropdownElement
          if (!dropdownEl) continue
          const match = await this.performSearch(dropdownEl, candidate)
          if (match) {
            match.dispatchEvent(
              new Event('mouseup', { bubbles: true, cancelable: true }),
            )
            filled = true
            break
          }
        }
      } finally {
        if (this.dropdownIsOpen) this.toggleDropdown()
      }
    })
    return filled
  }
}
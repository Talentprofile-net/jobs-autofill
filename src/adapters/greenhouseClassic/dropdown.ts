import fieldFillerQueue from '~/core/asyncQueue'
import { getElement, getElements } from '~/core/getElements'
import { findOption, xpathLiteral } from '~/core/match'
import { GreenhouseBaseInput } from './GreenhouseBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'

export class Dropdown extends GreenhouseBaseInput {
  static XPATH = xpaths.SIMPLE_DROPDOWN
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

  private get dropdownIsOpen(): boolean {
    return this.select2ContainerElement?.classList.contains(
      'select2-dropdown-open',
    ) ?? false
  }

  private toggleDropdown(): void {
    this.select2ContainerAElement?.dispatchEvent(new MouseEvent('mousedown'))
  }

  currentValue(): string {
    return this.select2ContainerAElement?.innerText ?? ''
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice') return false
    const candidates = [value.preferred, ...value.fallbacks]
    let filled = false
    await fieldFillerQueue.enqueue(async () => {
      if (!this.dropdownIsOpen) this.toggleDropdown()
      if (!this.dropdownIsOpen) return
      const dd = this.dropdownElement
      if (!dd) return
      const items = getElements(dd, './/li')
      for (const candidate of candidates) {
        const match = findOption(items, (li) => li.innerText, candidate)
        if (match) {
          match.dispatchEvent(
            new Event('mouseup', { bubbles: true, cancelable: true }),
          )
          filled = true
          break
        }
      }
      if (this.dropdownIsOpen) this.toggleDropdown()
    })
    return filled
  }
}
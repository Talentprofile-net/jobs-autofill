import fieldFillerQueue from '~/core/asyncQueue'
import { getElement, getElements } from '~/core/getElements'
import { createKeyboardEvent } from '~/core/events'
import { optionMatches, optionMatchesRelaxed } from '~/core/match'
import { GreenhouseBaseInput } from './GreenhouseBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'

type SelectedChip = { el: HTMLElement; text: string }

const extractChipText = (chip: HTMLElement): string => {
  let out = ''
  for (const node of chip.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? ''
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      if (el.tagName.toLowerCase() === 'a') continue
      out += el.innerText ?? el.textContent ?? ''
    }
  }
  return out.trim()
}

export class DropdownMulti extends GreenhouseBaseInput {
  static XPATH = xpaths.DROPDOWN_MULTI
  override fieldType = 'MultiSearchableDropdown'

  private get select2Container(): HTMLElement | null {
    return getElement(
      this.element,
      `.//div[contains(@class, "select2-container")]`,
    )
  }

  private get searchInput(): HTMLInputElement | null {
    return getElement(
      this.element,
      ".//input[@type='text']",
    ) as HTMLInputElement | null
  }

  private get choiceList(): HTMLElement | null {
    return getElement(this.element, `.//ul[@class="select2-choices"]`)
  }

  private get selectedChips(): SelectedChip[] {
    if (!this.choiceList) return []
    return getElements(this.choiceList, `.//li[@class="select2-search-choice"]`).map(
      (el) => ({ el, text: extractChipText(el) }),
    )
  }

  private get dropdownEl(): HTMLElement | null {
    return getElement(document.body, `./div[@id="select2-drop"]`)
  }

  private get isOpen(): boolean {
    return this.select2Container?.classList.contains('select2-dropdown-open') ?? false
  }

  currentValue(): string {
    return this.selectedChips.map((o) => o.text).join(', ')
  }

  private async selectCandidate(candidate: string): Promise<boolean> {
    const dd = this.dropdownEl
    if (!dd) return false
    const choices = getElements(dd, `.//li`)
    const target =
      choices.find((c) => optionMatches(c.innerText, candidate)) ??
      choices.find((c) => optionMatchesRelaxed(c.innerText, candidate))
    if (!target) return false
    target.dispatchEvent(new Event('mouseup', { bubbles: true, cancelable: true }))
    return true
  }

  private chipMatchesTarget(chip: SelectedChip, target: string): boolean {
    if (optionMatches(chip.text, target)) return true
    if (optionMatchesRelaxed(chip.text, target)) return true
    return false
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice' && value.kind !== 'multiChoice') return false
    const input = this.searchInput
    if (!input) return false

    let filled = false
    await fieldFillerQueue.enqueue(async () => {
      const desiredTargets: string[] =
        value.kind === 'multiChoice'
          ? (value.preferred.length > 0 ? value.preferred : value.fallbacks)
          : [value.preferred, ...value.fallbacks]

      if (desiredTargets.length === 0) return

      const currentChips = this.selectedChips
      const targetsToAdd = desiredTargets.filter(
        (target) => !currentChips.some((chip) => this.chipMatchesTarget(chip, target)),
      )

      if (targetsToAdd.length === 0) return

      if (!this.isOpen) input.click()
      const dd = this.dropdownEl
      if (!dd) {
        input.dispatchEvent(createKeyboardEvent('keydown', 'Escape'))
        return
      }

      let anyAdded = false
      if (value.kind === 'choice') {
        for (const candidate of targetsToAdd) {
          if (!this.isOpen) input.click()
          if (await this.selectCandidate(candidate)) {
            anyAdded = true
            break
          }
        }
      } else {
        for (const candidate of targetsToAdd) {
          if (!this.isOpen) input.click()
          if (await this.selectCandidate(candidate)) {
            anyAdded = true
          }
        }
      }

      filled = anyAdded
      input.dispatchEvent(createKeyboardEvent('keydown', 'Escape'))
    })
    return filled
  }
}
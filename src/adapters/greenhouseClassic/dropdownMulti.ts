import fieldFillerQueue from '~/core/asyncQueue'
import { getElement, getElements } from '~/core/getElements'
import { createKeyboardEvent } from '~/core/events'
import { findOption, optionMatches, optionMatchesRelaxed } from '~/core/match'
import { sleep } from '~/core/async'
import { GreenhouseBaseInput } from './GreenhouseBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'

const CHIP_SETTLE_MS = 80

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

const chipRemoveLink = (chip: HTMLElement): HTMLElement | null =>
  getElement(chip, ".//a[contains(@class, 'select2-search-choice-close')]")

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

  currentValue(): string[] {
    return this.selectedChips.map((c) => c.text)
  }

  private chipMatchesTarget(chip: SelectedChip, target: string): boolean {
    if (optionMatches(chip.text, target)) return true
    if (optionMatchesRelaxed(chip.text, target)) return true
    return false
  }

  private async selectCandidate(candidate: string): Promise<boolean> {
    const dd = this.dropdownEl
    if (!dd) return false
    const choices = getElements(dd, `.//li`)
    const target = findOption(choices, (c) => c.innerText, candidate)
    if (!target) return false
    target.dispatchEvent(new Event('mouseup', { bubbles: true, cancelable: true }))
    await sleep(CHIP_SETTLE_MS)
    return true
  }

  private async removeChip(chip: SelectedChip): Promise<boolean> {
    const closeBtn = chipRemoveLink(chip.el)
    if (!closeBtn) return false
    closeBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    closeBtn.click()
    await sleep(CHIP_SETTLE_MS)
    return !this.selectedChips.some((c) => this.chipMatchesTarget(c, chip.text))
  }

  private finalSetMatches(desiredTargets: string[]): boolean {
    const finalChips = this.selectedChips
    if (finalChips.length !== desiredTargets.length) return false
    return desiredTargets.every((t) =>
      finalChips.some((chip) => this.chipMatchesTarget(chip, t)),
    )
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice' && value.kind !== 'multiChoice') return false
    const input = this.searchInput
    if (!input) return false

    return fieldFillerQueue.enqueue(async () => {
      const initialDesiredTargets: string[] =
        value.kind === 'multiChoice'
          ? value.preferred.length > 0
            ? value.preferred
            : value.fallbacks
          : [value.preferred, ...value.fallbacks].slice(0, 1)

      if (initialDesiredTargets.length === 0) return false

      const currentChips = this.selectedChips
      const chipsToRemove = currentChips.filter(
        (chip) => !initialDesiredTargets.some((t) => this.chipMatchesTarget(chip, t)),
      )

      const targetsToAdd = initialDesiredTargets.filter(
        (target) => !currentChips.some((chip) => this.chipMatchesTarget(chip, target)),
      )

      const finalDesiredTargets: string[] = [...initialDesiredTargets]

      if (chipsToRemove.length === 0 && targetsToAdd.length === 0) {
        return this.finalSetMatches(finalDesiredTargets)
      }

      for (const chip of chipsToRemove) {
        await this.removeChip(chip)
      }

      if (targetsToAdd.length > 0) {
        if (!this.isOpen) input.click()
        const dd = this.dropdownEl
        if (!dd) {
          input.dispatchEvent(createKeyboardEvent('keydown', 'Escape'))
          return false
        }

        if (value.kind === 'choice') {
          finalDesiredTargets.length = 0
          for (const candidate of [value.preferred, ...value.fallbacks]) {
            if (!this.isOpen) input.click()
            if (await this.selectCandidate(candidate)) {
              finalDesiredTargets.push(candidate)
              break
            }
          }
        } else {
          for (const candidate of targetsToAdd) {
            if (!this.isOpen) input.click()
            await this.selectCandidate(candidate)
          }
        }
      }

      input.dispatchEvent(createKeyboardEvent('keydown', 'Escape'))

      return this.finalSetMatches(finalDesiredTargets)
    })
  }
}
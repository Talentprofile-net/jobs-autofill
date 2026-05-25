import fieldFillerQueue from '~/core/asyncQueue'
import { getElement, getElements, waitForElement } from '~/core/getElements'
import { scrollBack } from '~/core/scroll'
import { getReactProps } from '~/core/reactProps'
import { sleep } from '~/core/verify'
import { GreenhouseReactBaseInput } from './GreenhouseReactBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'
import { findOption, optionMatches, optionMatchesRelaxed } from '~/core/match'

const VERIFY_SETTLE_MS = 150

type SelectedChip = { el: HTMLElement; text: string }

const extractChipText = (chip: HTMLElement): string => {
  const label = getElement(chip, `.//div[starts-with(@class, "select__multi-value__label")]`)
  if (label) return label.innerText.trim()
  let out = ''
  for (const node of chip.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? ''
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      out += (node as HTMLElement).innerText ?? ''
    }
  }
  return out.trim()
}

export class DropdownMultiSearchable extends GreenhouseReactBaseInput {
  static XPATH = xpaths.DROPDOWN_MULTI_SEARCHABLE
  override fieldType = 'MultiSearchableDropdown'

  private get searchInput(): HTMLInputElement | null {
    return getElement(
      this.element,
      `.//input[@class="select__input"]`,
    ) as HTMLInputElement | null
  }

  private get selectedChipsRaw(): HTMLElement[] {
    return getElements(
      this.element,
      `.//div[starts-with(@class, "select__multi-value")]`,
    )
  }

  private get selectedChips(): SelectedChip[] {
    return this.selectedChipsRaw.map((el) => ({ el, text: extractChipText(el) }))
  }

  private get menuOpenTriggerDiv(): HTMLElement | null {
    return getElement(
      this.element,
      `.//div[starts-with(@class, "select-shell")]/div[not(@*)]`,
    )
  }

  currentValue(): string {
    return this.selectedChips.map((c) => c.text).join(', ')
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

  private async findOptionAfterSearch(candidate: string): Promise<HTMLElement | null> {
    const input = this.searchInput
    if (!input) return null
    input.value = candidate
    getReactProps(input)?.onChange?.({
      currentTarget: input,
      target: input,
      preventDefault: () => {},
      stopPropagation: () => {},
    })
    const dd = await waitForElement(
      this.element,
      `.//div[starts-with(@class, "select__menu")]`,
      { timeout: 300 },
    )
    if (!dd) return null
    const options = getElements(dd, `.//div[starts-with(@class, "select__option")]`)
    return findOption(options, (o) => o.innerText, candidate)
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

  private chipMatchesTarget(chip: SelectedChip, target: string): boolean {
    if (optionMatches(chip.text, target)) return true
    if (optionMatchesRelaxed(chip.text, target)) return true
    return false
  }

  private async addCandidate(candidate: string): Promise<boolean> {
    this.openDropdown()
    const match = await this.findOptionAfterSearch(candidate)
    if (match) {
      match.click()
      await sleep(VERIFY_SETTLE_MS)
      const chips = this.selectedChips
      return chips.some((c) => this.chipMatchesTarget(c, candidate))
    }
    return false
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice' && value.kind !== 'multiChoice') return false
    const input = this.searchInput
    if (!input) return false

    let filled = false
    await scrollBack(
      async () => {
        await fieldFillerQueue.enqueue(async () => {
          const desiredTargets: string[] =
            value.kind === 'multiChoice'
              ? (value.preferred.length > 0 ? value.preferred : value.fallbacks)
              : [value.preferred, ...value.fallbacks]

          if (desiredTargets.length === 0) {
            this.blurInput()
            return
          }

          const currentChips = this.selectedChips
          const targetsToAdd = desiredTargets.filter(
            (target) => !currentChips.some((chip) => this.chipMatchesTarget(chip, target)),
          )

          if (targetsToAdd.length === 0) {
            this.blurInput()
            return
          }

          let anyAdded = false
          if (value.kind === 'choice') {
            for (const candidate of targetsToAdd) {
              if (await this.addCandidate(candidate)) {
                anyAdded = true
                break
              }
            }
          } else {
            for (const candidate of targetsToAdd) {
              if (await this.addCandidate(candidate)) {
                anyAdded = true
              }
            }
          }

          filled = anyAdded
          this.blurInput()
        })
      },
      { element: this.element },
    )
    return filled
  }
}
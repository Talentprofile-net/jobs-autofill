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

type SelectedChip = { el: HTMLElement; text: string; removeBtn: HTMLElement | null }

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

const findChipRemoveBtn = (chip: HTMLElement): HTMLElement | null =>
  getElement(chip, `.//div[starts-with(@class, "select__multi-value__remove")]`)

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
    return this.selectedChipsRaw.map((el) => ({
      el,
      text: extractChipText(el),
      removeBtn: findChipRemoveBtn(el),
    }))
  }

  private get menuOpenTriggerDiv(): HTMLElement | null {
    return getElement(
      this.element,
      `.//div[starts-with(@class, "select-shell")]/div[not(@*)]`,
    )
  }

  currentValue(): string[] {
    return this.selectedChips.map((c) => c.text)
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

  private async findOptionAfterSearch(candidate: string): Promise<HTMLElement | null> {
    const input = this.searchInput
    if (!input) return null
    input.value = candidate
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
    const dd = await waitForElement(
      this.element,
      `.//div[starts-with(@class, "select__menu")]`,
      { timeout: 600 },
    )
    if (!dd) return null
    const options = getElements(dd, `.//div[starts-with(@class, "select__option")]`)
    return findOption(options, (o) => o.innerText, candidate)
  }

  private blurInput(): void {
    const input = this.searchInput
    if (!input) return
    const reactProps = getReactProps(input)
    if (reactProps?.onBlur) {
      reactProps.onBlur({
        target: input,
        currentTarget: input,
        preventDefault: () => {},
        stopPropagation: () => {},
      })
    } else {
      input.blur()
    }
  }

  private chipMatchesTarget(chip: SelectedChip, target: string): boolean {
    if (optionMatches(chip.text, target)) return true
    if (optionMatchesRelaxed(chip.text, target)) return true
    return false
  }

  private async removeChip(chip: SelectedChip): Promise<boolean> {
    const btn = chip.removeBtn
    if (!btn) return false
    const reactProps = getReactProps(btn)
    if (reactProps?.onMouseDown) {
      reactProps.onMouseDown({
        button: 0,
        preventDefault: () => {},
        stopPropagation: () => {},
      })
    } else {
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    }
    await sleep(40)
    return !this.selectedChips.some((c) => this.chipMatchesTarget(c, chip.text))
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
      return await scrollBack(
        async () => {
          const initialDesiredTargets: string[] =
            value.kind === 'multiChoice'
              ? value.preferred.length > 0
                ? value.preferred
                : value.fallbacks
              : [value.preferred, ...value.fallbacks].slice(0, 1)

          if (initialDesiredTargets.length === 0) {
            this.blurInput()
            return false
          }

          const currentChips = this.selectedChips

          const chipsToRemove = currentChips.filter(
            (chip) => !initialDesiredTargets.some((t) => this.chipMatchesTarget(chip, t)),
          )

          const targetsToAdd = initialDesiredTargets.filter(
            (target) => !currentChips.some((chip) => this.chipMatchesTarget(chip, target)),
          )

          const finalDesiredTargets: string[] = [...initialDesiredTargets]

          if (chipsToRemove.length === 0 && targetsToAdd.length === 0) {
            this.blurInput()
            return this.finalSetMatches(finalDesiredTargets)
          }

          for (const chip of chipsToRemove) {
            await this.removeChip(chip)
          }

          if (targetsToAdd.length > 0) {
            if (value.kind === 'choice') {
              finalDesiredTargets.length = 0
              for (const candidate of [value.preferred, ...value.fallbacks]) {
                if (await this.addCandidate(candidate)) {
                  finalDesiredTargets.push(candidate)
                  break
                }
              }
            } else {
              for (const candidate of targetsToAdd) {
                await this.addCandidate(candidate)
              }
            }
          }

          this.blurInput()
          return this.finalSetMatches(finalDesiredTargets)
        },
        { element: this.element },
      )
    })
  }
}
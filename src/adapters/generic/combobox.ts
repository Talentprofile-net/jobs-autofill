import fieldFillerQueue from '~/core/asyncQueue'
import { waitForElement } from '~/core/getElements'
import { findOption, optionMatchesRelaxed, optionMatches } from '~/core/match'
import { setNativeInputValue } from '~/core/reactProps'
import { createKeyboardEvent } from '~/core/events'
import { sleep } from '~/core/verify'
import { GenericBaseField } from './GenericBaseField'
import type { ProfileValue } from '~/field/types'

const OPEN_SETTLE_MS = 150
const LISTBOX_WAIT_MS = 600
const OPTION_WAIT_MS = 600
const SELECTION_SETTLE_MS = 150

const listboxByExplicitRelation = (combobox: HTMLElement): HTMLElement | null => {
  const controls = combobox.getAttribute('aria-controls')
  if (controls) {
    const byId = document.getElementById(controls)
    if (byId && byId.getAttribute('role') === 'listbox') return byId
  }
  const owns = combobox.getAttribute('aria-owns')
  if (owns) {
    const byId = document.getElementById(owns)
    if (byId && byId.getAttribute('role') === 'listbox') return byId
  }
  return null
}

const waitForListboxByRelation = async (
  combobox: HTMLElement,
  timeoutMs: number,
): Promise<HTMLElement | null> => {
  const direct = listboxByExplicitRelation(combobox)
  if (direct) return direct

  return new Promise<HTMLElement | null>((resolve) => {
    let resolved = false
    const observer = new MutationObserver(() => {
      if (resolved) return
      const found = listboxByExplicitRelation(combobox)
      if (found) {
        resolved = true
        observer.disconnect()
        clearTimeout(timer)
        resolve(found)
      }
    })
    const timer = setTimeout(() => {
      if (resolved) return
      resolved = true
      observer.disconnect()
      resolve(null)
    }, timeoutMs)
    observer.observe(combobox, {
      attributes: true,
      attributeFilter: ['aria-controls', 'aria-owns', 'aria-expanded'],
    })
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    })
  })
}

const isOpen = (combobox: HTMLElement): boolean =>
  combobox.getAttribute('aria-expanded') === 'true'

const waitForOptions = async (
  listbox: HTMLElement,
  timeoutMs: number,
): Promise<HTMLElement[]> => {
  const result = await waitForElement(listbox, './/*[@role="option"]', {
    timeout: timeoutMs,
  })
  if (!result) return []
  return Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]'))
}

const findInternalInput = (combobox: HTMLElement): HTMLInputElement | null => {
  if (combobox instanceof HTMLInputElement) return combobox
  return combobox.querySelector('input') as HTMLInputElement | null
}

export class GenericCombobox extends GenericBaseField {
  override fieldType = 'SimpleDropdown'

  static SELECTOR = '[role="combobox"]'

  static qualifies(el: HTMLElement): boolean {
    if (el.getAttribute('aria-disabled') === 'true') return false
    if (el.hasAttribute('disabled')) return false
    return true
  }

  currentValue(): string {
    const input = findInternalInput(this.element)
    if (input?.value) return input.value
    return this.element.textContent?.trim() ?? ''
  }

  private async openMenu(): Promise<HTMLElement | null> {
    if (!isOpen(this.element)) {
      this.element.click()
      await sleep(OPEN_SETTLE_MS)
    }
    return waitForListboxByRelation(this.element, LISTBOX_WAIT_MS)
  }

  private async typeIntoCombobox(text: string): Promise<void> {
    const input = findInternalInput(this.element)
    if (!input) return
    input.focus()
    setNativeInputValue(input, text)
    input.dispatchEvent(new InputEvent('input', { bubbles: true }))
    await sleep(OPEN_SETTLE_MS)
  }

  private async closeMenu(): Promise<void> {
    if (!isOpen(this.element)) return
    const input = findInternalInput(this.element)
    if (input) {
      input.dispatchEvent(createKeyboardEvent('keydown', 'Escape'))
      input.blur()
    } else {
      this.element.dispatchEvent(createKeyboardEvent('keydown', 'Escape'))
    }
  }

  private isMatched(candidate: string): boolean {
    const current = this.currentValue()
    if (!current) return false
    if (optionMatches(current, candidate)) return true
    return optionMatchesRelaxed(current, candidate)
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice') return false
    const candidates = [value.preferred, ...value.fallbacks]

    let success = false
    await fieldFillerQueue.enqueue(async () => {
      try {
        for (const candidate of candidates) {
          if (this.isMatched(candidate)) {
            success = true
            return
          }

          const initialListbox = await this.openMenu()
          if (!initialListbox) continue

          await this.typeIntoCombobox(candidate)

          const liveListbox =
            (await waitForListboxByRelation(this.element, LISTBOX_WAIT_MS)) ??
            initialListbox

          const options = await waitForOptions(liveListbox, OPTION_WAIT_MS)
          if (options.length === 0) {
            await this.closeMenu()
            continue
          }

          const match = findOption(options, (o) => o.innerText, candidate)
          if (!match) {
            await this.closeMenu()
            continue
          }

          match.click()
          await sleep(SELECTION_SETTLE_MS)

          if (this.isMatched(candidate)) {
            success = true
            return
          }
        }
      } finally {
        await this.closeMenu()
      }
    })
    return success
  }
}
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
const OBSERVER_SCOPE_MAX_DEPTH = 8

const isListboxVisible = (lb: HTMLElement): boolean => {
  if (lb.hidden) return false
  if (lb.getAttribute('aria-hidden') === 'true') return false
  const r = lb.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return false
  return true
}

const listboxByExplicitRelation = (combobox: HTMLElement): HTMLElement | null => {
  const controls = combobox.getAttribute('aria-controls')
  if (controls) {
    const byId = document.getElementById(controls)
    if (byId && byId.getAttribute('role') === 'listbox' && isListboxVisible(byId)) return byId
  }
  const owns = combobox.getAttribute('aria-owns')
  if (owns) {
    const byId = document.getElementById(owns)
    if (byId && byId.getAttribute('role') === 'listbox' && isListboxVisible(byId)) return byId
  }
  return null
}

const findFloatingListbox = (combobox: HTMLElement): HTMLElement | null => {
  const lists = document.querySelectorAll<HTMLElement>('[role="listbox"]')
  const cbRect = combobox.getBoundingClientRect()
  let best: HTMLElement | null = null
  let bestDist = Infinity
  for (const lb of lists) {
    if (!isListboxVisible(lb)) continue
    const r = lb.getBoundingClientRect()
    const verticallyTouching =
      Math.abs(r.top - cbRect.bottom) < 40 ||
      Math.abs(cbRect.top - r.bottom) < 40
    const horizontallyAligned =
      Math.abs(r.left - cbRect.left) < 80 ||
      Math.abs(r.right - cbRect.right) < 80
    if (!verticallyTouching || !horizontallyAligned) continue
    const dx = Math.min(
      Math.abs(r.left - cbRect.left),
      Math.abs(r.right - cbRect.right),
    )
    const dy = Math.min(
      Math.abs(r.top - cbRect.bottom),
      Math.abs(cbRect.top - r.bottom),
    )
    const dist = dx + dy
    if (dist < bestDist) {
      bestDist = dist
      best = lb
    }
  }
  return best
}

const observerScope = (combobox: HTMLElement): HTMLElement => {
  let node: HTMLElement | null = combobox.parentElement
  let depth = 0
  while (node && depth < OBSERVER_SCOPE_MAX_DEPTH) {
    const tag = node.tagName.toLowerCase()
    if (tag === 'form') return node
    if (tag === 'fieldset') return node
    if (tag === 'main') return node
    if (tag === 'section') return node
    if (node.getAttribute('role') === 'form') return node
    if (node.getAttribute('role') === 'main') return node
    node = node.parentElement
    depth++
  }
  return document.documentElement
}

const waitForListboxByRelation = async (
  combobox: HTMLElement,
  timeoutMs: number,
): Promise<HTMLElement | null> => {
  const direct = listboxByExplicitRelation(combobox)
  if (direct) return direct

  return new Promise<HTMLElement | null>((resolve) => {
    let resolved = false
    const cleanup = (result: HTMLElement | null) => {
      if (resolved) return
      resolved = true
      observer.disconnect()
      scopeObserver.disconnect()
      bodyObserver.disconnect()
      clearTimeout(timer)
      resolve(result)
    }
    const observer = new MutationObserver(() => {
      if (resolved) return
      const found =
        listboxByExplicitRelation(combobox) ?? findFloatingListbox(combobox)
      if (found) cleanup(found)
    })
    const scopeObserver = new MutationObserver(() => {
      if (resolved) return
      if (!document.documentElement.contains(combobox)) {
        cleanup(null)
        return
      }
      const found =
        listboxByExplicitRelation(combobox) ?? findFloatingListbox(combobox)
      if (found) cleanup(found)
    })
    const bodyObserver = new MutationObserver(() => {
      if (resolved) return
      const found =
        listboxByExplicitRelation(combobox) ?? findFloatingListbox(combobox)
      if (found) cleanup(found)
    })
    const timer = setTimeout(() => {
      cleanup(findFloatingListbox(combobox))
    }, timeoutMs)
    observer.observe(combobox, {
      attributes: true,
      attributeFilter: ['aria-controls', 'aria-owns', 'aria-expanded'],
    })
    const scope = observerScope(combobox)
    scopeObserver.observe(scope, {
      childList: true,
      subtree: true,
    })
    bodyObserver.observe(document.body, {
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

const readCommittedValue = (combobox: HTMLElement): string => {
  const controls = combobox.getAttribute('aria-controls')
  if (controls) {
    const listbox = document.getElementById(controls)
    if (listbox) {
      const selected = listbox.querySelector<HTMLElement>(
        '[role="option"][aria-selected="true"]',
      )
      const text = selected?.innerText?.trim()
      if (text) return text
    }
  }
  if (!isOpen(combobox)) {
    const input = findInternalInput(combobox)
    if (input?.value) return input.value
    return combobox.textContent?.trim() ?? ''
  }
  return ''
}

export class GenericCombobox extends GenericBaseField {
  override fieldType = 'SimpleDropdown'

  static SELECTOR = '[role="combobox"]'

  static qualifies(el: HTMLElement): boolean {
    if (el.getAttribute('aria-disabled') === 'true') return false
    if (el.hasAttribute('disabled')) return false
    if (el.hasAttribute('readonly')) return false
    if (el.getAttribute('aria-readonly') === 'true') return false
    return true
  }

  currentValue(): string {
    return readCommittedValue(this.element)
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
    await sleep(OPEN_SETTLE_MS)
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

    return fieldFillerQueue.enqueue(async () => {
      try {
        for (const candidate of candidates) {
          if (this.isMatched(candidate)) return true

          const initialListbox = await this.openMenu()
          if (!initialListbox) continue

          await this.typeIntoCombobox(candidate)

          const liveListbox =
            (await waitForListboxByRelation(this.element, LISTBOX_WAIT_MS)) ??
            initialListbox

          const options = await waitForOptions(liveListbox, OPTION_WAIT_MS)
          if (options.length === 0) continue

          const match = findOption(options, (o) => o.innerText, candidate)
          if (!match) continue

          match.click()
          await sleep(SELECTION_SETTLE_MS)

          if (this.isMatched(candidate)) return true
        }
        return false
      } finally {
        await this.closeMenu()
      }
    })
  }
}
import fieldFillerQueue from '~/core/asyncQueue'
import { waitForElement } from '~/core/getElements'
import { findDialSelectorOption, findUniqueDialCodeOption, findUniqueOption, isDialCodeOptionSet, isDialCodeValue, optionMatchesRelaxed, optionMatches } from '~/core/match'
import { UnsupportedFillError } from '~/field/unsupportedFill'
import { setNativeInputValue } from '~/core/reactProps'
import { createKeyboardEvent } from '~/core/events'
import { sleep } from '~/core/verify'
import { GenericBaseField } from './GenericBaseField'
import { COMBOBOX_SELECTOR, comboboxQualifies } from './dom'
import type { ProfileValue } from '~/field/types'
import { getElementByIdInScope, querySelectorDeep, rootQueryScope } from '~/core/shadowDom'
import { activateControl } from '~/core/activate'

const OPEN_SETTLE_MS = 150
const LISTBOX_WAIT_MS = 600
const OPTION_WAIT_MS = 600
const SEARCH_RESULTS_WAIT_MS = 3000
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
    const byId = getElementByIdInScope(combobox, controls)
    if (byId && byId.getAttribute('role') === 'listbox' && isListboxVisible(byId)) return byId
  }
  const owns = combobox.getAttribute('aria-owns')
  if (owns) {
    const byId = getElementByIdInScope(combobox, owns)
    if (byId && byId.getAttribute('role') === 'listbox' && isListboxVisible(byId)) return byId
  }
  return null
}

const findFloatingListbox = (combobox: HTMLElement): HTMLElement | null => {
  const scope = rootQueryScope(combobox)
  const lists = [
    ...Array.from(document.querySelectorAll<HTMLElement>('[role="listbox"]')),
    ...(scope === document ? [] : Array.from(scope.querySelectorAll<HTMLElement>('[role="listbox"]'))),
  ]
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
      if (!combobox.isConnected) {
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
  return querySelectorDeep<HTMLInputElement>(combobox, 'input')
}


const isSearchOnly = (combobox: HTMLElement): boolean => {
  const input = findInternalInput(combobox)
  return input !== null && !input.readOnly && !input.disabled
}

const pickSearchResult = (options: HTMLElement[], candidate: string): HTMLElement | null =>
  findUniqueOption(options, (o) => o.innerText, candidate) ??
  options.find((o) => optionMatches(o.innerText ?? '', candidate)) ??
  null

const isDialCodeListbox = (options: HTMLElement[]): boolean =>
  isDialCodeOptionSet(
    options.map((o) => o.innerText ?? o.textContent ?? ''),
    options.filter((o) => o.hasAttribute('data-dial-code')).length,
  )

const readCommittedValue = (combobox: HTMLElement): string => {
  const controls = combobox.getAttribute('aria-controls')
  if (controls) {
    const listbox = getElementByIdInScope(combobox, controls)
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

  static SELECTOR = COMBOBOX_SELECTOR

  static qualifies(el: HTMLElement): boolean {
    return comboboxQualifies(el)
  }

  currentValue(): string {
    return readCommittedValue(this.element)
  }

  private async openMenu(): Promise<HTMLElement | null> {
    if (!isOpen(this.element)) {
      activateControl(this.element)
      await sleep(OPEN_SETTLE_MS)
    }
    return waitForListboxByRelation(this.element, LISTBOX_WAIT_MS)
  }

  private async typeIntoCombobox(text: string): Promise<void> {
    const input = findInternalInput(this.element)
    if (!input || input.readOnly) return
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

    const typedInput = findInternalInput(this.element)
    const original = typedInput?.value ?? ''
    let selected = false
    let dialCodeMismatch = false
    const done = await fieldFillerQueue.enqueue(async () => {
      try {
        if (candidates.some((candidate) => this.isMatched(candidate))) return true
        const initial = await this.openMenu()
        const initialOptions = initial ? await waitForOptions(initial, OPTION_WAIT_MS) : []
        if (isDialCodeListbox(initialOptions)) {
          const match = findDialSelectorOption(initialOptions, (o) => o.innerText ?? '', candidates, (o) => o.getAttribute('data-dial-code'))
          if (!match) {
            dialCodeMismatch = true
            return false
          }
          const text = match.innerText ?? ''
          activateControl(match)
          await sleep(SELECTION_SETTLE_MS)
          selected = optionMatches(this.currentValue(), text)
          return selected
        }
        const searchDeadline = Date.now() + SEARCH_RESULTS_WAIT_MS
        let searched = false
        for (const candidate of candidates) {
          if (this.isMatched(candidate)) return true
          if (searched && Date.now() >= searchDeadline) break

          const initialListbox = await this.openMenu()
          const searchOnly = !initialListbox && isSearchOnly(this.element)
          if (!initialListbox && !searchOnly) continue
          searched = searched || searchOnly

          await this.typeIntoCombobox(candidate)

          const liveListbox =
            (await waitForListboxByRelation(this.element, searchOnly ? Math.max(searchDeadline - Date.now(), 0) : LISTBOX_WAIT_MS)) ??
            initialListbox
          if (!liveListbox) continue

          const options = await waitForOptions(liveListbox, searchOnly ? Math.max(searchDeadline - Date.now(), OPTION_WAIT_MS) : OPTION_WAIT_MS)
          if (options.length === 0) continue
          const dialCodes = isDialCodeListbox(options)
          if (dialCodes && !isDialCodeValue(candidate)) {
            dialCodeMismatch = true
            continue
          }

          const match = dialCodes
            ? findUniqueDialCodeOption(options, (o) => o.innerText ?? '', candidate, (o) => o.getAttribute('data-dial-code'))
            : searchOnly
              ? pickSearchResult(options, candidate)
              : findUniqueOption(options, (o) => o.innerText, candidate)
          if (!match) continue

          activateControl(match)
          await sleep(SELECTION_SETTLE_MS)

          if (this.isMatched(candidate)) {
            selected = true
            return true
          }
        }
        return false
      } finally {
        await this.closeMenu()
        if (!selected && typedInput && typedInput.value !== original) {
          setNativeInputValue(typedInput, original)
          typedInput.dispatchEvent(new InputEvent('input', { bubbles: true }))
        }
      }
    })
    if (!done && dialCodeMismatch) throw new UnsupportedFillError('dial-code selector needs a dial code')
    return done
  }
}
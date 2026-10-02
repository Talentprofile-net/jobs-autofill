import { setNativeInputValue } from './reactProps'
import { findUniqueOption, normalizeOption, optionMatches, optionMatchesRelaxed } from './match'
import { getElementByIdInScope } from './shadowDom'
import { holdsFor, waitUntil } from './verify'

const TYPEAHEAD_HINT = /(dropdown|autocomplete|auto-complete|typeahead|type-ahead|suggest)/i
const RESULTS_HINT = /(results|options|suggestions|listbox|menu)/i
const NO_RESULTS_HINT = /(no-?results?|no-?matches|not-?found|empty)/i
const NON_ITEM_HINT = /(no-?results?|no-?matches|not-?found|empty|loading|spinner|error|status)/i
const CONTROL_SELECTOR = 'input, select, textarea, button'

export type TypeaheadTiming = {
  suggestionsTimeoutMs: number
  settleTimeoutMs: number
  pollMs: number
}

export const DEFAULT_TYPEAHEAD_TIMING: TypeaheadTiming = {
  pollMs: 50,
  settleTimeoutMs: 1_500,
  suggestionsTimeoutMs: 3_000,
}

const hintOf = (el: Element): string => `${el.id} ${el.getAttribute('class') ?? ''}`

const isShown = (el: Element): boolean => {
  const probe = el as Element & { checkVisibility?: (options?: object) => boolean }
  if (typeof probe.checkVisibility === 'function') {
    return probe.checkVisibility({ opacityProperty: true, visibilityProperty: true })
  }
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (node.hasAttribute('hidden')) return false
    if (/display\s*:\s*none/i.test(node.getAttribute('style') ?? '')) return false
  }
  return true
}

const textOf = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

export const typeaheadScope = (input: HTMLInputElement): HTMLElement | null => {
  const parent = input.parentElement
  if (!parent) return null
  const autocomplete = (input.getAttribute('aria-autocomplete') ?? '').toLowerCase()
  if (autocomplete === 'list' || autocomplete === 'both') return parent
  for (const sibling of Array.from(parent.children)) {
    if (sibling === input) continue
    if (!TYPEAHEAD_HINT.test(hintOf(sibling))) continue
    if (sibling.matches(CONTROL_SELECTOR) || sibling.querySelector(CONTROL_SELECTOR)) continue
    return parent
  }
  return null
}

const ownedListbox = (input: HTMLInputElement): HTMLElement | null => {
  for (const attr of ['aria-controls', 'aria-owns']) {
    const id = input.getAttribute(attr)
    const el = id ? getElementByIdInScope(input, id) : null
    if (el) return el
  }
  return null
}

export const suggestionItems = (input: HTMLInputElement, scope: HTMLElement): HTMLElement[] => {
  const roots = [scope, ownedListbox(input)].filter((r): r is HTMLElement => r !== null)
  const seen = new Set<HTMLElement>()
  const items: HTMLElement[] = []
  const add = (el: HTMLElement) => {
    if (seen.has(el) || el === input || el.contains(input)) return
    if (!isShown(el) || !textOf(el) || NON_ITEM_HINT.test(hintOf(el))) return
    seen.add(el)
    items.push(el)
  }
  for (const root of roots) {
    for (const option of Array.from(root.querySelectorAll<HTMLElement>('[role="option"]'))) add(option)
  }
  if (items.length > 0) return items
  for (const root of roots) {
    const containers = Array.from(root.querySelectorAll<HTMLElement>('*')).filter(
      (el) => !el.contains(input) && RESULTS_HINT.test(hintOf(el)) && !NON_ITEM_HINT.test(hintOf(el)) && isShown(el),
    )
    for (const container of containers) {
      for (const child of Array.from(container.children)) add(child as HTMLElement)
    }
  }
  return items
}

const noResultsShown = (scope: HTMLElement): boolean =>
  Array.from(scope.querySelectorAll('*')).some((el) => NO_RESULTS_HINT.test(hintOf(el)) && isShown(el) && textOf(el) !== '')

type SuggestionState = { items: HTMLElement[]; noResults: boolean; responded: boolean }

const observeSuggestions = (input: HTMLInputElement, scope: HTMLElement) => {
  const observer = new MutationObserver(() => {})
  const options = { attributes: true, characterData: true, childList: true, subtree: true }
  observer.observe(scope, options)
  const listbox = ownedListbox(input)
  if (listbox && !scope.contains(listbox)) observer.observe(listbox, options)
  return observer
}

const waitForFreshSuggestions = (
  input: HTMLInputElement,
  scope: HTMLElement,
  observer: MutationObserver,
  timing: TypeaheadTiming,
): Promise<SuggestionState> =>
  new Promise((resolve) => {
    const fromPage = (records: MutationRecord[]) => records.some((r) => r.target !== input)
    let responded = fromPage(observer.takeRecords())
    const read = (): SuggestionState => ({ items: suggestionItems(input, scope), noResults: noResultsShown(scope), responded })
    const settled = (state: SuggestionState) => state.responded && (state.items.length > 0 || state.noResults)
    let done = false
    const finish = (state: SuggestionState) => {
      if (done) return
      done = true
      clearTimeout(timer)
      watcher.disconnect()
      resolve(state)
    }
    const watcher = new MutationObserver((records) => {
      if (!fromPage(records)) return
      responded = true
      const state = read()
      if (settled(state)) finish(state)
    })
    const options = { attributes: true, characterData: true, childList: true, subtree: true }
    watcher.observe(scope, options)
    const listbox = ownedListbox(input)
    if (listbox && !scope.contains(listbox)) watcher.observe(listbox, options)
    const timer = setTimeout(() => finish(read()), timing.suggestionsTimeoutMs)
    const initial = read()
    if (settled(initial)) finish(initial)
  })

const typeValue = (input: HTMLInputElement, text: string): void => {
  input.focus()
  setNativeInputValue(input, text)
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }))
  const key = text.slice(-1)
  input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }))
  input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key }))
}

const activate = (option: HTMLElement): void => {
  for (const type of ['mousedown', 'mouseup', 'click']) {
    option.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }))
  }
}

type Snapshot = { visible: string; hidden: Array<[HTMLInputElement, string]> }

const hiddenSelectionInputs = (scope: HTMLElement): HTMLInputElement[] =>
  Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="hidden"]'))

const snapshot = (input: HTMLInputElement, scope: HTMLElement): Snapshot => ({
  hidden: hiddenSelectionInputs(scope).map((el) => [el, el.value]),
  visible: input.value,
})

const restore = (input: HTMLInputElement, state: Snapshot): void => {
  input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
  input.blur()
  setNativeInputValue(input, state.visible)
  input.dispatchEvent(new InputEvent('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  for (const [el, value] of state.hidden) {
    if (el.value !== value) el.value = value
  }
}

const valueReflects = (input: HTMLInputElement, optionText: string, candidate: string): boolean => {
  const value = input.value
  if (!normalizeOption(value)) return false
  return optionMatches(value, optionText) || optionMatchesRelaxed(value, candidate)
}

const selectCandidate = async (
  input: HTMLInputElement,
  scope: HTMLElement,
  candidate: string,
  timing: TypeaheadTiming,
): Promise<boolean> => {
  const observer = observeSuggestions(input, scope)
  try {
    typeValue(input, candidate)
    const state = await waitForFreshSuggestions(input, scope, observer, timing)
    if (!state.responded || state.noResults || state.items.length === 0) return false
    const match = findUniqueOption(state.items, textOf, candidate)
    if (!match) return false
    const matchText = textOf(match)
    activate(match)
    const accept = () => valueReflects(input, matchText, candidate)
    if (!(await waitUntil(accept, timing.settleTimeoutMs, timing.pollMs))) return false
    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.blur()
    return holdsFor(accept, Math.min(timing.settleTimeoutMs, 500), timing.pollMs)
  } finally {
    observer.disconnect()
  }
}

export const fillTypeahead = async (
  input: HTMLInputElement,
  scope: HTMLElement,
  candidates: string[],
  timing: TypeaheadTiming = DEFAULT_TYPEAHEAD_TIMING,
): Promise<boolean> => {
  const original = snapshot(input, scope)
  for (const candidate of candidates) {
    if (!normalizeOption(candidate)) continue
    if (await selectCandidate(input, scope, candidate, timing)) return true
  }
  restore(input, original)
  return false
}

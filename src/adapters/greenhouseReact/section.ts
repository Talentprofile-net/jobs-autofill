import { getElements } from '~/core/getElements'
import { SECTION_XPATH, sectionNumbers } from './sectionNumbers'

const REASSIGN_DEBOUNCE_MS = 100
let reassignTimer: number | null = null

const assignNumbersToSections = (): void => {
  for (const [el, value] of sectionNumbers()) {
    if (el.getAttribute('jaf-section') !== value) el.setAttribute('jaf-section', value)
  }
}

const scheduleReassign = (): void => {
  if (reassignTimer !== null) window.clearTimeout(reassignTimer)
  reassignTimer = window.setTimeout(() => {
    reassignTimer = null
    assignNumbersToSections()
  }, REASSIGN_DEBOUNCE_MS)
}

const registeredObservers = new WeakMap<HTMLElement, MutationObserver>()
let initialized = false

export class Section {
  static XPATH = SECTION_XPATH

  static autoDiscover(node: Node = document): void {
    const elements = getElements(node, this.XPATH)
    if (elements.length === 0) return

    if (!initialized) {
      initialized = true
      assignNumbersToSections()
    } else {
      scheduleReassign()
    }

    const parents = new Set<HTMLElement>()
    for (const el of elements) {
      if (el.parentElement) parents.add(el.parentElement)
    }
    for (const parent of parents) {
      if (registeredObservers.has(parent)) continue
      const observer = new MutationObserver((mutations) => {
        if (!document.documentElement.contains(parent)) {
          observer.disconnect()
          registeredObservers.delete(parent)
          return
        }
        const sectionChanged = mutations.some(
          (m) => m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0),
        )
        if (sectionChanged) {
          scheduleReassign()
        }
      })
      observer.observe(parent, { childList: true })
      registeredObservers.set(parent, observer)
    }
  }
}
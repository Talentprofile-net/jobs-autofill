import { getElement, getElements } from '~/core/getElements'

const SECTION_XPATH = [
  `.//div`,
  `[contains(@class, 'education--form')`,
  ` or contains(@class, 'employment--form')]`,
].join('')

const sectionTypeOf = (el: HTMLElement): string => {
  const cls = el.getAttribute('class') ?? ''
  if (cls.includes('education')) return 'education'
  if (cls.includes('employment')) return 'employment'
  return 'section'
}

const REASSIGN_DEBOUNCE_MS = 100
let reassignTimer: number | null = null

const assignNumbersToSections = (): void => {
  const grouped = new Map<string, HTMLElement[]>()
  const sectionElements = getElements(document, SECTION_XPATH)
  sectionElements.forEach((el) => {
    const type = sectionTypeOf(el)
    const list = grouped.get(type) ?? []
    list.push(el)
    grouped.set(type, list)
  })
  for (const [type, els] of grouped) {
    els.forEach((el, idx) => {
      const newValue = `${type} ${idx + 1}`
      if (el.getAttribute('jaf-section') !== newValue) {
        el.setAttribute('jaf-section', newValue)
      }
    })
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
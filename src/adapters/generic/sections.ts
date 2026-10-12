import { resolveLabelledByText } from '~/core/labelledBy'
import { composedParent, querySelectorAllDeep } from '~/core/shadowDom'
import { isRefusedSection } from '~/resolver/questionTopics'

type SectionKind = 'employment' | 'education'

const SECTION_PATTERNS: Record<SectionKind, RegExp> = {
  employment: /\b(experience|employment|work\s*history|job\s*history|professional\s*history)\b/i,
  education: /\b(education|school|university|college|academic)\b/i,
}

type EnclosingSection = {
  kind: SectionKind
  container: HTMLElement
}

const visibleText = (el: Element | null): string =>
  ((el instanceof HTMLElement ? el.innerText : null) ?? el?.textContent ?? '').replace(/\s+/g, ' ').trim()

const containerText = (node: HTMLElement): string | null => {
  const fieldset = node.tagName.toLowerCase() === 'fieldset' ? node : null
  if (!fieldset && node.getAttribute('role') !== 'group') return null
  const legend = fieldset
    ? (fieldset.querySelector(':scope > legend') as HTMLElement | null)
    : null
  const ariaLabel = node.getAttribute('aria-label') ?? ''
  const labelledByText = resolveLabelledByText(node.getAttribute('aria-labelledby'), node)
  return `${visibleText(legend)} ${ariaLabel} ${labelledByText}`.replace(/\s+/g, ' ').trim()
}

const containerSectionKind = (node: HTMLElement): SectionKind | null => {
  const text = containerText(node)
  if (!text) return null
  for (const kind of ['employment', 'education'] as const) {
    if (SECTION_PATTERNS[kind].test(text)) return kind
  }
  return null
}

const composedAncestors = (el: HTMLElement): HTMLElement[] => {
  const out: HTMLElement[] = []
  for (let node = composedParent(el); node && node !== document.body; node = composedParent(node)) {
    if (node instanceof HTMLElement) out.push(node)
  }
  return out
}

const findEnclosingSection = (el: HTMLElement): EnclosingSection | null => {
  for (const node of composedAncestors(el)) {
    const kind = containerSectionKind(node)
    if (kind) return { kind, container: node }
  }
  return null
}

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, [role="heading"]'

const precedingHeading = (node: HTMLElement): string | null => {
  for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
    const heading = sib.matches(HEADING_SELECTOR) ? sib : Array.from(sib.querySelectorAll(HEADING_SELECTOR)).pop()
    if (heading) return visibleText(heading)
  }
  return null
}

export const contextSection = (el: HTMLElement): string => {
  for (const node of composedAncestors(el)) {
    const legend = containerText(node)
    if (legend) return isRefusedSection(legend) ? legend : ''
    const heading = precedingHeading(node)
    if (heading !== null) return isRefusedSection(heading) ? heading : ''
  }
  return ''
}

type SectionsCache = {
  employment: HTMLElement[]
  education: HTMLElement[]
}

let cache: SectionsCache | null = null
let observerInstalled = false
let invalidationTimer: number | null = null

const CACHE_INVALIDATION_DEBOUNCE_MS = 100

const invalidateCache = (): void => {
  cache = null
}

const scheduleInvalidate = (): void => {
  if (invalidationTimer !== null) return
  invalidationTimer = window.setTimeout(() => {
    invalidationTimer = null
    invalidateCache()
  }, CACHE_INVALIDATION_DEBOUNCE_MS)
}

const ensureObserver = (): void => {
  if (observerInstalled) return
  if (typeof document === 'undefined') return
  observerInstalled = true
  const observer = new MutationObserver(() => {
    scheduleInvalidate()
  })
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['role', 'aria-label', 'aria-labelledby'],
  })
}

const buildCache = (): SectionsCache => {
  const employment: HTMLElement[] = []
  const education: HTMLElement[] = []
  const seen = new Set<HTMLElement>()
  const fieldsets = querySelectorAllDeep<HTMLElement>(document, 'fieldset')
  const roleGroups = querySelectorAllDeep<HTMLElement>(document, '[role="group"]')
  for (const node of [...fieldsets, ...roleGroups]) {
    if (seen.has(node)) continue
    seen.add(node)
    const kind = containerSectionKind(node)
    if (kind === 'employment') employment.push(node)
    else if (kind === 'education') education.push(node)
  }
  return { employment, education }
}

const collectAllSectionsOfKind = (kind: SectionKind): HTMLElement[] => {
  ensureObserver()
  if (!cache) cache = buildCache()
  return cache[kind]
}

export const inferSection = (el: HTMLElement): string => {
  const enclosing = findEnclosingSection(el)
  if (!enclosing) return contextSection(el)
  const { kind, container } = enclosing

  const peers = collectAllSectionsOfKind(kind)
  const idx = peers.indexOf(container)
  if (idx < 0) {
    invalidateCache()
    const refreshed = collectAllSectionsOfKind(kind)
    const retryIdx = refreshed.indexOf(container)
    if (retryIdx < 0) return ''
    return `${kind} ${retryIdx + 1}`
  }
  return `${kind} ${idx + 1}`
}
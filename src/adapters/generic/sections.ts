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

const headingLevel = (heading: Element): number => {
  const tag = /^H([1-6])$/.exec(heading.tagName)
  if (tag) return Number(tag[1])
  const level = Number(heading.getAttribute('aria-level'))
  return Number.isInteger(level) && level > 0 ? level : 2
}

function* precedingHeadings(el: HTMLElement): Generator<Element> {
  for (const node of [el, ...composedAncestors(el)]) {
    for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (sib.matches(HEADING_SELECTOR)) yield sib
      else yield* Array.from(sib.querySelectorAll(HEADING_SELECTOR)).reverse()
    }
  }
}

const headingOutline = (el: HTMLElement): string[] => {
  const out: string[] = []
  let ceiling = Infinity
  for (const heading of precedingHeadings(el)) {
    const level = headingLevel(heading)
    if (level >= ceiling) continue
    out.push(visibleText(heading))
    ceiling = level
    if (level <= 1) break
  }
  return out
}

export const refusedContext = (el: HTMLElement): string => {
  const containers = composedAncestors(el).map(containerText).filter((text): text is string => Boolean(text))
  return [...containers, ...headingOutline(el)].find(isRefusedSection) ?? ''
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

export const createEntrySectionReader = (): ((el: HTMLElement) => string) => {
  let peers: SectionsCache | null = null
  return (el) => {
    const enclosing = findEnclosingSection(el)
    if (!enclosing) return ''
    peers ??= buildCache()
    const index = peers[enclosing.kind].indexOf(enclosing.container)
    return index < 0 ? '' : `${enclosing.kind} ${index + 1}`
  }
}

export const inferSection = (el: HTMLElement): string => {
  const enclosing = findEnclosingSection(el)
  if (!enclosing) return refusedContext(el)
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
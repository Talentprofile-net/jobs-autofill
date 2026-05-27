import { resolveLabelledByText } from '~/core/labelledBy'

type SectionKind = 'employment' | 'education'

const SECTION_PATTERNS: Record<SectionKind, RegExp> = {
  employment: /\b(experience|employment|work\s*history|job\s*history|professional\s*history)\b/i,
  education: /\b(education|school|university|college|academic)\b/i,
}

type EnclosingSection = {
  kind: SectionKind
  container: HTMLElement
}

const containerSectionKind = (node: HTMLElement): SectionKind | null => {
  const fieldset = node.tagName.toLowerCase() === 'fieldset' ? node : null
  const role = node.getAttribute('role')
  if (!fieldset && role !== 'group') return null

  const legend = fieldset
    ? (fieldset.querySelector(':scope > legend') as HTMLElement | null)
    : null
  const ariaLabel = node.getAttribute('aria-label') ?? ''
  const labelledByText = resolveLabelledByText(node.getAttribute('aria-labelledby'))
  const text =
    (legend?.innerText ?? '') + ' ' + ariaLabel + ' ' + labelledByText

  for (const kind of ['employment', 'education'] as const) {
    if (SECTION_PATTERNS[kind].test(text)) return kind
  }
  return null
}

const findEnclosingSection = (el: HTMLElement): EnclosingSection | null => {
  let node: HTMLElement | null = el.parentElement
  while (node && node !== document.body) {
    const kind = containerSectionKind(node)
    if (kind) return { kind, container: node }
    node = node.parentElement
  }
  return null
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
  const fieldsets = Array.from(document.querySelectorAll<HTMLElement>('fieldset'))
  const roleGroups = Array.from(
    document.querySelectorAll<HTMLElement>('[role="group"]'),
  )
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
  if (!enclosing) return ''
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
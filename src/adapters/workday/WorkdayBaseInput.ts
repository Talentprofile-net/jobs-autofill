import { getElement, getElements } from '~/core/getElements'
import { BaseField } from '~/field/baseField'

type SectionKind = 'employment' | 'education' | 'other'

const EMPLOYMENT_LABEL_PATTERNS: RegExp[] = [
  /\b(company|employer|organization|organisation)\b/i,
  /\b(job\s*title|position\s*title|role\s*title)\b/i,
  /\bemployment\s*type\b/i,
]

const EDUCATION_LABEL_PATTERNS: RegExp[] = [
  /\b(school|university|college|institution)\b/i,
  /\b(degree|qualification)\b/i,
  /\b(field\s*of\s*study|major|discipline)\b/i,
  /\bgpa\b/i,
]

const FIELD_LABEL_XPATH = `.//label | .//legend`
const SECTION_DEBOUNCE_MS = 100

const classifyFresh = (container: HTMLElement): SectionKind => {
  const labelEls = getElements(container, FIELD_LABEL_XPATH)
  const labels = labelEls.map((el) => el.innerText ?? '').filter(Boolean)
  if (labels.length === 0) return 'other'

  let employmentHits = 0
  let educationHits = 0
  for (const label of labels) {
    if (EMPLOYMENT_LABEL_PATTERNS.some((re) => re.test(label))) employmentHits++
    if (EDUCATION_LABEL_PATTERNS.some((re) => re.test(label))) educationHits++
  }

  if (employmentHits === 0 && educationHits === 0) return 'other'
  if (employmentHits > educationHits) return 'employment'
  if (educationHits > employmentHits) return 'education'
  return 'employment'
}

let classificationCache = new WeakMap<HTMLElement, SectionKind>()

const classifyContainer = (container: HTMLElement): SectionKind => {
  const cached = classificationCache.get(container)
  if (cached !== undefined) return cached
  const kind = classifyFresh(container)
  classificationCache.set(container, kind)
  return kind
}

const findClosestSectionContainer = (start: HTMLElement): HTMLElement | null => {
  let node: HTMLElement | null = start.parentElement
  while (node) {
    const tag = node.tagName.toLowerCase()
    if (tag === 'fieldset') return node
    if (node.getAttribute('role') === 'group') return node
    node = node.parentElement
  }
  return null
}

let indexCache: {
  byKind: Map<SectionKind, HTMLElement[]>
} | null = null

let sectionObserver: MutationObserver | null = null
let invalidationTimer: number | null = null

const scheduleIndexInvalidation = (): void => {
  if (invalidationTimer !== null) return
  invalidationTimer = window.setTimeout(() => {
    invalidationTimer = null
    indexCache = null
  }, SECTION_DEBOUNCE_MS)
}

const findApplicationRoot = (): HTMLElement => {
  const xpath = ".//div[@data-automation-id='applicationPage' or @data-automation-id='jobApplyPage' or @role='main']"
  const el = getElement(document, xpath)
  return el ?? document.body
}

const ensureSectionObserver = (): void => {
  if (sectionObserver) return
  if (typeof document === 'undefined') return
  const root = findApplicationRoot()
  sectionObserver = new MutationObserver((mutations) => {
    let touched = false
    for (const m of mutations) {
      if (m.type !== 'childList') continue
      const target = m.target as Node
      let node: HTMLElement | null = target instanceof HTMLElement
        ? target
        : target.parentElement
      while (node) {
        if (
          node.tagName.toLowerCase() === 'fieldset' ||
          node.getAttribute('role') === 'group'
        ) {
          classificationCache.delete(node)
          touched = true
        }
        node = node.parentElement
      }
    }
    if (touched) scheduleIndexInvalidation()
  })
  sectionObserver.observe(root, {
    childList: true,
    subtree: true,
  })
}

export const invalidateWorkdaySectionCache = (): void => {
  indexCache = null
  classificationCache = new WeakMap()
}

const buildIndexCache = (): {
  byKind: Map<SectionKind, HTMLElement[]>
} => {
  const allContainers = getElements(
    document,
    './/fieldset | .//div[@role="group"]',
  )
  const byKind = new Map<SectionKind, HTMLElement[]>()
  byKind.set('employment', [])
  byKind.set('education', [])
  byKind.set('other', [])
  for (const container of allContainers) {
    const kind = classifyContainer(container)
    byKind.get(kind)!.push(container)
  }
  return { byKind }
}

const indexAmongPeers = (
  container: HTMLElement,
  kind: SectionKind,
): number | null => {
  if (kind === 'other') return null
  if (!indexCache) {
    indexCache = buildIndexCache()
  }
  const peers = indexCache.byKind.get(kind) ?? []
  const idx = peers.indexOf(container)
  if (idx >= 0) return idx
  indexCache = buildIndexCache()
  const refreshed = indexCache.byKind.get(kind) ?? []
  const retryIdx = refreshed.indexOf(container)
  return retryIdx >= 0 ? retryIdx : null
}

export abstract class WorkdayBaseInput extends BaseField {
  private get sectionContainer(): HTMLElement | null {
    return findClosestSectionContainer(this.element)
  }

  override get section(): string {
    ensureSectionObserver()
    const container = this.sectionContainer
    if (!container) return ''
    const kind = classifyContainer(container)
    if (kind === 'other') return ''
    const index = indexAmongPeers(container, kind)
    if (index === null) return ''
    return `${kind} ${index + 1}`
  }
}
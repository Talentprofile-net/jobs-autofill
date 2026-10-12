import { getElements } from '~/core/getElements'

export type SectionKind = 'employment' | 'education' | 'other'

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
export const MIN_FIELDS_FOR_SECTION = 3
const FORM_FIELD_XPATH =
  ".//*[starts-with(@data-automation-id, 'formField-')]"

export const classifyFresh = (container: HTMLElement): SectionKind => {
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
  return 'other'
}

export const countFormFields = (container: HTMLElement): number =>
  getElements(container, FORM_FIELD_XPATH).length

const isSectionCandidate = (node: HTMLElement): boolean => {
  const tag = node.tagName.toLowerCase()
  if (tag !== 'fieldset' && node.getAttribute('role') !== 'group') return false
  return true
}

export const findSectionContainer = (start: HTMLElement): HTMLElement | null => {
  let node: HTMLElement | null = start.parentElement
  let firstCandidate: HTMLElement | null = null
  while (node) {
    if (isSectionCandidate(node)) {
      if (firstCandidate === null) firstCandidate = node
      if (countFormFields(node) >= MIN_FIELDS_FOR_SECTION) {
        return node
      }
    }
    node = node.parentElement
  }
  return firstCandidate
}

export const indexSectionContainers = (classify: (container: HTMLElement) => SectionKind): Map<SectionKind, HTMLElement[]> => {
  const allContainers = getElements(
    document,
    './/fieldset | .//div[@role="group"]',
  ).filter((el) => countFormFields(el) >= MIN_FIELDS_FOR_SECTION)
  const byKind = new Map<SectionKind, HTMLElement[]>()
  byKind.set('employment', [])
  byKind.set('education', [])
  byKind.set('other', [])
  for (const container of allContainers) {
    const kind = classify(container)
    byKind.get(kind)!.push(container)
  }
  return byKind
}

export const createSectionReader = (): ((el: HTMLElement) => string) => {
  const kinds = new WeakMap<HTMLElement, SectionKind>()
  const classify = (container: HTMLElement): SectionKind => {
    const known = kinds.get(container)
    if (known !== undefined) return known
    const kind = classifyFresh(container)
    kinds.set(container, kind)
    return kind
  }
  let peers: Map<SectionKind, HTMLElement[]> | null = null
  return (el) => {
    const container = findSectionContainer(el)
    if (!container || countFormFields(container) < MIN_FIELDS_FOR_SECTION) return ''
    const kind = classify(container)
    if (kind === 'other') return ''
    peers ??= indexSectionContainers(classify)
    const index = peers.get(kind)?.indexOf(container) ?? -1
    return index < 0 ? '' : `${kind} ${index + 1}`
  }
}

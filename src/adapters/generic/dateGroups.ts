import { isInsideRegistered, isVisible } from '~/field/baseField'

export type DatePart = 'month' | 'day' | 'year'

export type DateGroup = {
  anchor: HTMLInputElement
  parts: Record<DatePart, HTMLInputElement | null>
  container: HTMLElement
}

const MONTH_TOKENS = ['mm', 'm', 'month']
const DAY_TOKENS = ['dd', 'd', 'day']
const YEAR_TOKENS = ['yyyy', 'yy', 'y', 'year']
const MAX_SHARED_ANCESTOR_DEPTH = 4

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z]+/g)
    .filter((t) => t.length > 0)

const hasToken = (tokens: string[], candidates: string[]): boolean =>
  tokens.some((t) => candidates.includes(t))

const partKindOf = (input: HTMLInputElement): DatePart | null => {
  const sources = [
    input.getAttribute('placeholder') ?? '',
    input.getAttribute('aria-label') ?? '',
    input.getAttribute('name') ?? '',
    input.getAttribute('id') ?? '',
    input.getAttribute('data-test') ?? '',
    input.getAttribute('autocomplete') ?? '',
  ]
  for (const src of sources) {
    if (!src) continue
    const tokens = tokenize(src)
    if (tokens.length === 0) continue
    if (hasToken(tokens, MONTH_TOKENS)) return 'month'
    if (hasToken(tokens, DAY_TOKENS)) return 'day'
    if (hasToken(tokens, YEAR_TOKENS)) return 'year'
  }
  return null
}

const tableRowContainer = (input: HTMLElement): HTMLElement | null => {
  let node: HTMLElement | null = input.parentElement
  let depth = 0
  while (node && depth < 6) {
    const tag = node.tagName.toLowerCase()
    if (tag === 'tr' || tag === 'tbody' || tag === 'table') return node
    node = node.parentElement
    depth++
  }
  return null
}

const explicitContainer = (input: HTMLElement): HTMLElement | null => {
  const fieldset = input.closest('fieldset') as HTMLElement | null
  if (fieldset) return fieldset
  const roleGroup = input.closest('[role="group"]') as HTMLElement | null
  if (roleGroup) return roleGroup
  const table = tableRowContainer(input)
  if (table) return table
  return null
}

const smallestContainerWithSiblings = (
  input: HTMLInputElement,
  allCandidates: HTMLInputElement[],
): HTMLElement | null => {
  let node: HTMLElement | null = input.parentElement
  let depth = 0
  while (node && depth < MAX_SHARED_ANCESTOR_DEPTH) {
    let siblingCount = 0
    for (const other of allCandidates) {
      if (other === input) continue
      if (node.contains(other)) {
        siblingCount++
        if (siblingCount >= 1) break
      }
    }
    if (siblingCount >= 1) return node
    node = node.parentElement
    depth++
  }
  return null
}

export const discoverDateGroups = (root: ParentNode): DateGroup[] => {
  const candidates = Array.from(
    root.querySelectorAll<HTMLInputElement>(
      'input[type="text"], input[type="number"], input:not([type])',
    ),
  ).filter((el) => {
    if (isInsideRegistered(el)) return false
    if (!isVisible(el)) return false
    if (el.hasAttribute('disabled')) return false
    return partKindOf(el) !== null
  })

  type Bucket = {
    container: HTMLElement
    parts: Partial<Record<DatePart, HTMLInputElement>>
    order: HTMLInputElement[]
  }
  const buckets = new Map<HTMLElement, Bucket>()

  for (const input of candidates) {
    const kind = partKindOf(input)
    if (!kind) continue

    let container = explicitContainer(input)
    if (!container) {
      container = smallestContainerWithSiblings(input, candidates)
    }
    if (!container) continue

    const bucket = buckets.get(container) ?? {
      container,
      parts: {},
      order: [],
    }
    if (!bucket.parts[kind]) {
      bucket.parts[kind] = input
      bucket.order.push(input)
    }
    buckets.set(container, bucket)
  }

  const groups: DateGroup[] = []
  for (const bucket of buckets.values()) {
    const hasMonth = bucket.parts.month !== undefined
    const hasYear = bucket.parts.year !== undefined
    if (!hasMonth || !hasYear) continue
    groups.push({
      anchor: bucket.order[0],
      parts: {
        month: bucket.parts.month ?? null,
        day: bucket.parts.day ?? null,
        year: bucket.parts.year ?? null,
      },
      container: bucket.container,
    })
  }

  return groups
}
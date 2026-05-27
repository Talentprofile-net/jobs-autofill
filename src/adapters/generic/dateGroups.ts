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
const PROXIMITY_THRESHOLD_PX = 200

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
    if (tag === 'tr') return node
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

type Candidate = {
  input: HTMLInputElement
  kind: DatePart
  rect: DOMRect
}

const rectsClose = (a: DOMRect, b: DOMRect): boolean => {
  const dx = Math.min(
    Math.abs(a.right - b.left),
    Math.abs(b.right - a.left),
    Math.abs(a.left - b.left),
  )
  const dy = Math.abs(a.top - b.top)
  return dx <= PROXIMITY_THRESHOLD_PX && dy <= PROXIMITY_THRESHOLD_PX
}

const buildGroupsFromCandidates = (
  candidates: Candidate[],
  container: HTMLElement,
): DateGroup[] => {
  const sorted = [...candidates].sort((a, b) => {
    if (a.rect.top !== b.rect.top) return a.rect.top - b.rect.top
    return a.rect.left - b.rect.left
  })

  const used = new Set<HTMLInputElement>()
  const groups: DateGroup[] = []

  for (const seed of sorted) {
    if (used.has(seed.input)) continue
    const cluster: Record<DatePart, Candidate | null> = {
      month: null,
      day: null,
      year: null,
    }
    cluster[seed.kind] = seed
    used.add(seed.input)

    for (const other of sorted) {
      if (used.has(other.input)) continue
      if (cluster[other.kind]) continue
      const anchorRect = cluster[seed.kind]!.rect
      if (!rectsClose(anchorRect, other.rect)) continue
      cluster[other.kind] = other
      used.add(other.input)
    }

    if (!cluster.month || !cluster.year) {
      used.delete(seed.input)
      if (cluster.day) used.delete(cluster.day.input)
      if (cluster.month) used.delete(cluster.month.input)
      if (cluster.year) used.delete(cluster.year.input)
      continue
    }

    groups.push({
      anchor: seed.input,
      parts: {
        month: cluster.month?.input ?? null,
        day: cluster.day?.input ?? null,
        year: cluster.year?.input ?? null,
      },
      container,
    })
  }

  return groups
}

export const discoverDateGroups = (root: ParentNode): DateGroup[] => {
  const candidateInputs = Array.from(
    root.querySelectorAll<HTMLInputElement>(
      'input[type="text"], input[type="number"], input:not([type])',
    ),
  ).filter((el) => {
    if (isInsideRegistered(el)) return false
    if (!isVisible(el)) return false
    if (el.hasAttribute('disabled')) return false
    return partKindOf(el) !== null
  })

  const byContainer = new Map<HTMLElement, Candidate[]>()

  for (const input of candidateInputs) {
    const kind = partKindOf(input)
    if (!kind) continue

    let container = explicitContainer(input)
    if (!container) {
      container = tableRowContainer(input)
    }
    if (!container) {
      container = smallestContainerWithSiblings(input, candidateInputs)
    }
    if (!container) continue

    const list = byContainer.get(container) ?? []
    list.push({ input, kind, rect: input.getBoundingClientRect() })
    byContainer.set(container, list)
  }

  const allGroups: DateGroup[] = []
  for (const [container, candidates] of byContainer) {
    const monthCount = candidates.filter((c) => c.kind === 'month').length
    const yearCount = candidates.filter((c) => c.kind === 'year').length
    const dayCount = candidates.filter((c) => c.kind === 'day').length

    if (monthCount <= 1 && yearCount <= 1 && dayCount <= 1) {
      const parts: Record<DatePart, HTMLInputElement | null> = {
        month: candidates.find((c) => c.kind === 'month')?.input ?? null,
        day: candidates.find((c) => c.kind === 'day')?.input ?? null,
        year: candidates.find((c) => c.kind === 'year')?.input ?? null,
      }
      if (parts.month && parts.year) {
        const anchor = parts.month ?? candidates[0].input
        allGroups.push({ anchor, parts, container })
      }
      continue
    }

    const subgroups = buildGroupsFromCandidates(candidates, container)
    for (const g of subgroups) allGroups.push(g)
  }

  return allGroups
}
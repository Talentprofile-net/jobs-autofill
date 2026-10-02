import { composedContains, composedParent } from '~/core/shadowDom'

export type LogicalField = {
  element: Element
  fieldName: string
  fieldType: string
  section: string
}

const QUESTION_DEPTH = 6
const QUESTION_STOP = new Set(['FORM', 'BODY', 'HTML'])

const normalizeName = (name: string): string =>
  name.toLowerCase().replace(/[*✱]/g, ' ').replace(/\s+/g, ' ').trim()

const compact = (value: string): string => value.toLowerCase().replace(/[*✱\s]/g, '')

const questionKey = (field: LogicalField): string =>
  `${field.fieldType}|${field.section}|${normalizeName(field.fieldName)}`

export const questionContainer = (field: LogicalField): Element | null => {
  const parent = composedParent(field.element)
  const fallback = parent instanceof Element ? parent : null
  const needle = compact(field.fieldName)
  if (!needle) return fallback
  let node: Node | null = parent
  for (let depth = 0; node instanceof Element && depth < QUESTION_DEPTH && !QUESTION_STOP.has(node.tagName); depth++) {
    if (compact(node.textContent ?? '').includes(needle)) return node
    node = composedParent(node)
  }
  return fallback
}

type LedgerEntry = {
  key: string
  container: Element | null
  element: Element
  knownPeers: Element[]
}

export type FileAttachLedger = {
  claimed: (field: LogicalField) => boolean
  record: (field: LogicalField, peers: LogicalField[]) => void
}

export const createFileAttachLedger = (): FileAttachLedger => {
  const entries: LedgerEntry[] = []

  const holds = (entry: LedgerEntry, field: LogicalField, container: Element | null): boolean =>
    entry.element === field.element ||
    (entry.container !== null && entry.container.isConnected && (entry.container === container || composedContains(entry.container, field.element)))

  const isOrphanFor = (entry: LedgerEntry, field: LogicalField, container: Element | null): boolean =>
    !entry.element.isConnected &&
    (entry.container === null || !entry.container.isConnected) &&
    !entry.knownPeers.some((peer) => peer.isConnected && (peer === container || composedContains(peer, field.element)))

  const find = (field: LogicalField): LedgerEntry | null => {
    const key = questionKey(field)
    const container = questionContainer(field)
    const same = entries.filter((entry) => entry.key === key)
    const live = same.find((entry) => holds(entry, field, container))
    if (live) return live
    const orphan = same.find((entry) => isOrphanFor(entry, field, container))
    if (!orphan) return null
    orphan.element = field.element
    orphan.container = container
    return orphan
  }

  return {
    claimed: (field) => find(field) !== null,
    record: (field, peers) => {
      if (find(field)) return
      const key = questionKey(field)
      const container = questionContainer(field)
      const knownPeers = peers
        .filter((peer) => peer.element !== field.element && questionKey(peer) === key)
        .map(questionContainer)
        .filter((peer): peer is Element => peer !== null && peer !== container && !composedContains(peer, field.element))
      entries.push({ container, element: field.element, key, knownPeers })
    },
  }
}

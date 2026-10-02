import { mountFormFillButton } from './formWidgetMount'
import { allFields, detectFormContainer, fillFormContainer } from '~/field/registry'
import { applicationContainerFor, applicationEvidenceElements } from './applicationContainer'
import { requestFillGrant, requestOpenDashboard } from '~/bridge/mainBridge'
import { isVisible } from '~/field/baseField'
import type { ResolvedOriginMode } from '~/bridge/types'
import type { WidgetFillOutcome } from './formWidgetMount'
import { composedParent, isAttached, querySelectorAllDeep } from '~/core/shadowDom'

const MARKER_ATTR = 'data-tp-form-widget-host'
const ANCHOR_ATTR = 'data-tp-form-widget-anchor'

const mountedWidgets = new Map<
  HTMLElement,
  { destroy: () => void; anchor: HTMLElement }
>()

let currentMode: ResolvedOriginMode = 'notesOnly'

export const setFormWidgetMode = (mode: ResolvedOriginMode): void => {
  currentMode = mode
}

const FIELD_SELECTOR =
  'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="file"]),' +
  'select, textarea, [role="combobox"], fieldset, [data-tp-field]'

const findFirstFieldRow = (container: HTMLElement): HTMLElement | null => {
  const candidates = querySelectorAllDeep<HTMLElement>(container, FIELD_SELECTOR).filter((el) =>
    isVisible(el),
  )
  if (candidates.length === 0) return null
  const first = candidates[0]
  let node: Node = first
  let depth = 0
  while (node !== container && depth < 6) {
    const parent = composedParent(node)
    if (!parent) break
    if (parent === container) return node instanceof HTMLElement ? node : first
    node = parent
    depth++
  }
  return first.getRootNode() === document ? first : null
}

const countVisibleFields = (container: HTMLElement): number => {
  const els = querySelectorAllDeep<HTMLElement>(container, FIELD_SELECTOR)
  let count = 0
  for (const el of els) {
    if (!isVisible(el)) continue
    count++
    if (count >= 3) return count
  }
  return count
}

const fillContainer = (container: HTMLElement) => async (): Promise<WidgetFillOutcome> => {
  const grant = await requestFillGrant()
  if (grant.kind !== 'run') return { kind: grant.kind }
  const counts = await fillFormContainer(grant.batchId, container)
  return { counts, kind: 'filled', lowScore: grant.lowScore }
}

const mountForContainer = (container: HTMLElement): void => {
  if (mountedWidgets.has(container)) {
    const existing = mountedWidgets.get(container)!
    if (isAttached(existing.anchor)) return
    existing.destroy()
    mountedWidgets.delete(container)
  }

  const anchor = findFirstFieldRow(container)
  if (!anchor) return
  anchor.setAttribute(ANCHOR_ATTR, 'true')
  container.setAttribute(MARKER_ATTR, 'true')

  const handle = mountFormFillButton({
    container,
    anchorRow: anchor,
    onFillClick: fillContainer(container),
    onOpenEditorClick: async () => {
      requestOpenDashboard()
    },
  })

  mountedWidgets.set(container, { destroy: handle.destroy, anchor })
}

const sweepStaleWidgets = (): void => {
  for (const [container, entry] of mountedWidgets) {
    const stillInDom = isAttached(container)
    const anchorAlive = isAttached(entry.anchor)
    if (!stillInDom || !anchorAlive) {
      entry.destroy()
      mountedWidgets.delete(container)
    }
  }
}

const discoverContainers = (): HTMLElement[] => {
  const candidates = new Set<HTMLElement>()
  const primary = detectFormContainer()
  if (primary !== document.documentElement) {
    candidates.add(primary)
  }
  const forms = Array.from(document.querySelectorAll<HTMLElement>('form'))
  for (const form of forms) {
    if (isVisible(form)) candidates.add(form)
  }

  const candidateList = Array.from(candidates)
  const result: HTMLElement[] = []
  for (const c of candidateList) {
    const hasDescendantCandidate = candidateList.some(
      (other) => other !== c && c.contains(other),
    )
    if (!hasDescendantCandidate) result.push(c)
  }
  const qualified = result.filter((container) => countVisibleFields(container) >= 3)
  if (qualified.length > 0) return qualified
  const fallback = applicationContainerFor(
    applicationEvidenceElements(
      allFields().map((field) => ({
        attached: isAttached(field.element),
        displayed: field.isDisplayed(),
        element: field.element,
        fieldName: field.fieldName,
        fieldType: field.fieldType,
      })),
    ),
  )
  return fallback ? [fallback] : []
}

export const refreshFormWidgets = (): void => {
  if (currentMode === 'notesOnly') {
    destroyAllFormWidgets()
    return
  }
  sweepStaleWidgets()
  const containers = discoverContainers()
  for (const [container, entry] of mountedWidgets) {
    if (containers.includes(container)) continue
    entry.destroy()
    mountedWidgets.delete(container)
  }
  for (const container of containers) {
    mountForContainer(container)
  }
}

export const destroyAllFormWidgets = (): void => {
  for (const [, entry] of mountedWidgets) entry.destroy()
  mountedWidgets.clear()
}
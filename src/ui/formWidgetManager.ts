import { mountFormFillButton } from './formWidgetMount'
import { detectFormContainer, fillFormContainer } from '~/field/registry'
import {
  getAuthStatus,
  getProfileSummary,
  openDashboard,
  requestSignIn,
} from '~/bridge/mainBridge'
import { PROFILE_SCORE_EMPTY_BELOW } from '~/config'
import { isVisible } from '~/field/baseField'
import type { ResolvedOriginMode } from '~/bridge/types'

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
  const candidates = Array.from(
    container.querySelectorAll<HTMLElement>(FIELD_SELECTOR),
  ).filter((el) => isVisible(el))
  if (candidates.length === 0) return null
  const first = candidates[0]
  let node: HTMLElement | null = first
  let depth = 0
  while (node && node !== container && depth < 6) {
    const parent = node.parentElement as HTMLElement
    if (!parent) break
    if (parent === container) return node
    node = parent
    depth++
  }
  return first
}

const countVisibleFields = (container: HTMLElement): number => {
  const els = Array.from(
    container.querySelectorAll<HTMLElement>(FIELD_SELECTOR),
  )
  let count = 0
  for (const el of els) {
    if (!isVisible(el)) continue
    count++
    if (count >= 3) return count
  }
  return count
}

const isAuthenticated = async (): Promise<boolean> => {
  const status = await getAuthStatus()
  return status.authenticated
}

const isProfileUsable = async (): Promise<boolean> => {
  const summary = await getProfileSummary()
  if (!summary) return false
  return summary.profileScore >= PROFILE_SCORE_EMPTY_BELOW
}

const fillContainer = (container: HTMLElement) => async () => {
  return fillFormContainer(container)
}

const mountForContainer = (container: HTMLElement): void => {
  if (mountedWidgets.has(container)) {
    const existing = mountedWidgets.get(container)!
    if (document.documentElement.contains(existing.anchor)) return
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
    onSignInClick: async () => {
      requestSignIn()
    },
    onOpenEditorClick: async () => {
      openDashboard()
    },
    isAuthenticated,
    isProfileUsable,
  })

  mountedWidgets.set(container, { destroy: handle.destroy, anchor })
}

const sweepStaleWidgets = (): void => {
  for (const [container, entry] of mountedWidgets) {
    const stillInDom = document.documentElement.contains(container)
    const anchorAlive = document.documentElement.contains(entry.anchor)
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
  return result.filter((container) => countVisibleFields(container) >= 3)
}

export const refreshFormWidgets = (): void => {
  if (currentMode === 'notesOnly') {
    destroyAllFormWidgets()
    return
  }
  sweepStaleWidgets()
  const containers = discoverContainers()
  for (const container of containers) {
    mountForContainer(container)
  }
}

export const destroyAllFormWidgets = (): void => {
  for (const [, entry] of mountedWidgets) entry.destroy()
  mountedWidgets.clear()
}
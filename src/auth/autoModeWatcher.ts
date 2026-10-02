import { createShadowRootObserver } from '~/core/shadowDom'
import type { AutoModeVerdict } from './autoModeHeuristic'

export type AutoModeWatcherDeps = {
  evaluate: () => AutoModeVerdict
  observe: (onChange: () => void) => () => void
  onUpgrade: () => void
  debounceMs: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export type AutoModeWatcher = {
  verdict: () => AutoModeVerdict
  stop: () => void
}

export const createAutoModeWatcher = (deps: AutoModeWatcherDeps): AutoModeWatcher => {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  let current: AutoModeVerdict = deps.evaluate()
  let pending: unknown = null
  let disconnect: (() => void) | null = null

  const stop = () => {
    if (pending !== null) clearTimer(pending)
    pending = null
    disconnect?.()
    disconnect = null
  }

  const reevaluate = () => {
    pending = null
    if (current === 'application') return
    if (deps.evaluate() !== 'application') return
    current = 'application'
    stop()
    deps.onUpgrade()
  }

  if (current !== 'application') {
    disconnect = deps.observe(() => {
      if (current === 'application') return
      if (pending !== null) clearTimer(pending)
      pending = setTimer(reevaluate, deps.debounceMs)
    })
  }

  return { stop, verdict: () => current }
}

const TREE_OPTIONS: MutationObserverInit = {
  attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'open'],
  attributes: true,
  childList: true,
  subtree: true,
}

export type DocumentTreeObserver = {
  observe: (onChange: () => void) => () => void
  observedShadowRoots: () => number
}

export const createDocumentTreeObserver = (
  doc: Document,
  pollMs: number,
  setPoll: (fn: () => void, ms: number) => unknown = (fn, ms) => setInterval(fn, ms),
  clearPoll: (handle: unknown) => void = (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
): DocumentTreeObserver => {
  let notify: (() => void) | null = null
  const onMutation = (records: MutationRecord[]) => {
    if (!notify) return
    if (records.some((record) => record.addedNodes.length > 0)) sync()
    notify()
  }
  const shadows = createShadowRootObserver(onMutation, TREE_OPTIONS)
  const sync = () => shadows.sync(doc)
  return {
    observe: (onChange) => {
      notify = onChange
      const observer = new MutationObserver(onMutation)
      observer.observe(doc.documentElement, TREE_OPTIONS)
      sync()
      const poll = setPoll(() => {
        const before = shadows.observedCount()
        sync()
        if (shadows.observedCount() !== before) onChange()
      }, pollMs)
      return () => {
        notify = null
        observer.disconnect()
        shadows.disconnect()
        clearPoll(poll)
      }
    },
    observedShadowRoots: () => shadows.observedCount(),
  }
}

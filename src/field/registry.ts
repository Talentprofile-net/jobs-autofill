import { createFileAttachLedger, type FileAttachLedger } from './logicalIdentity'
import type { AtsName, FillOutcome, ProfileValue } from './types'
import type { FieldDescriptor, FillValueResult, ResolvedOriginMode } from '~/bridge/types'
import { FIELD_MARKER_ATTR } from '~/config'
import { BaseField } from './baseField'
import {
  emitFillProgress,
  emitFillResult,
  emitFillStarted,
  emitFillTotalIncreased,
  getOriginMode,
  onBridgeMessage,
  requestFillValues,
  sendFieldDescriptor,
} from '~/bridge/mainBridge'
import { detectAts as detectAtsHost } from '~/core/ats'
import { getElement } from '~/core/getElements'
import {
  composedContains,
  createShadowRootObserver,
  isAttached,
  querySelectorAllDeep,
} from '~/core/shadowDom'
import { RegisterInputs as registerWorkday } from '~/adapters/workday'
import { RegisterInputs as registerGreenhouseClassic } from '~/adapters/greenhouseClassic'
import { RegisterInputs as registerGreenhouseReact } from '~/adapters/greenhouseReact'
import { RegisterInputs as registerGeneric } from '~/adapters/generic'
import { teardownWorkdaySections } from '~/adapters/workday/WorkdayBaseInput'
import type { FillCounts } from '~/bridge/types'
import {
  destroyAllFormWidgets,
  refreshFormWidgets,
  setFormWidgetMode,
} from '~/ui/formWidgetManager'

export const detectAts = (): AtsName => detectAtsHost()

const fieldRegistry = new Map<string, BaseField>()

export const registerField = (field: BaseField): void => {
  fieldRegistry.set(field.uuid, field)
}

export const unregisterField = (uuid: string): void => {
  fieldRegistry.delete(uuid)
  remountState.delete(uuid)
}

export const allFields = (): BaseField[] => Array.from(fieldRegistry.values())

export const fieldByUuid = (uuid: string): BaseField | null => fieldRegistry.get(uuid) ?? null

let currentMode: ResolvedOriginMode = 'notesOnly'

export const getCurrentMode = (): ResolvedOriginMode => currentMode

const FORM_CONTAINER_XPATHS: Record<Exclude<AtsName, 'generic'>, string> = {
  greenhouseClassic: ".//form[@id='application_form'] | .//div[@id='application']",
  greenhouseReact:
    ".//div[contains(concat(' ', normalize-space(@class), ' '), ' application--container ')]",
  workday:
    ".//div[@data-automation-id='applicationPage' or @data-automation-id='jobApplyPage' or @role='main']",
}

const GENERIC_FORM_CONTAINER_XPATH = ".//form | .//div[@role='form']"

export const detectFormContainer = (): HTMLElement => {
  const ats = detectAts()
  if (ats !== 'generic') {
    const xpath = FORM_CONTAINER_XPATHS[ats]
    const container = getElement(document, xpath)
    if (container) return container
  } else {
    const container = getElement(document, GENERIC_FORM_CONTAINER_XPATH)
    if (container) return container
  }
  return document.documentElement
}

export const discoverAll = (node: Node = detectFormContainer()): void => {
  const ats = detectAts()

  if (ats === 'workday') {
    registerWorkday(node)
  } else if (ats === 'greenhouseClassic') {
    registerGreenhouseClassic(node)
  } else if (ats === 'greenhouseReact') {
    registerGreenhouseReact(node)
  } else {
    registerGeneric(node)
  }
}

const sweepStaleFields = (): void => {
  for (const [uuid, field] of fieldRegistry) {
    if (!isAttached(field.element)) {
      field.destroy()
      fieldRegistry.delete(uuid)
      remountState.delete(uuid)
    }
  }
}

type RemountState = {
  lastAttemptAt: number
  consecutiveFailures: number
}

const remountState = new Map<string, RemountState>()

const REMOUNT_BASE_BACKOFF_MS = 1000
const REMOUNT_MAX_BACKOFF_MS = 30_000
const REMOUNT_SUCCESS_VERIFY_MS = 250

const computeBackoff = (failures: number): number => {
  if (failures <= 0) return 0
  const exp = Math.min(failures, 6)
  const backoff = REMOUNT_BASE_BACKOFF_MS * Math.pow(2, exp - 1)
  return Math.min(backoff, REMOUNT_MAX_BACKOFF_MS)
}

const remountOrphanedWidgets = (): void => {
  const now = Date.now()
  for (const field of fieldRegistry.values()) {
    if (!isAttached(field.element)) continue
    if (field.hasLiveWidget()) {
      const state = remountState.get(field.uuid)
      if (state && state.consecutiveFailures > 0) {
        if (now - state.lastAttemptAt > REMOUNT_SUCCESS_VERIFY_MS) {
          remountState.delete(field.uuid)
        }
      }
      continue
    }
    const state = remountState.get(field.uuid) ?? {
      consecutiveFailures: 0,
      lastAttemptAt: 0,
    }
    const backoff = computeBackoff(state.consecutiveFailures)
    if (now - state.lastAttemptAt < backoff) continue
    field.remountWidget()
    state.lastAttemptAt = now
    state.consecutiveFailures += 1
    remountState.set(field.uuid, state)
  }
}

const resetRemountBackoff = (): void => {
  remountState.clear()
}

const stripOrphanedMarkers = (): void => {
  const marked = querySelectorAllDeep<HTMLElement>(
    document,
    `[${FIELD_MARKER_ATTR}]`,
  )
  for (const el of marked) {
    const uuid = el.getAttribute(FIELD_MARKER_ATTR)
    if (!uuid) continue
    const field = fieldRegistry.get(uuid)
    if (!field) {
      el.removeAttribute(FIELD_MARKER_ATTR)
      continue
    }
    if (field.element !== el) {
      el.removeAttribute(FIELD_MARKER_ATTR)
    }
  }
}

const PROGRESS_BATCH_MS = 80
const REDISCOVERY_SETTLE_MS = 350
const MAX_FILL_PASSES = 3

const createProgressEmitter = (batchId: string, getPass: () => number) => {
  let pending = {
    failed: 0,
    filled: 0,
    skipped: 0,
    unsupported: 0,
  }
  let timer: number | null = null
  const flushInner = () => {
    if (
      pending.filled === 0 &&
      pending.skipped === 0 &&
      pending.failed === 0 &&
      pending.unsupported === 0
    ) {
      timer = null
      return
    }
    const delta = pending
    pending = { failed: 0, filled: 0, skipped: 0, unsupported: 0 }
    timer = null
    emitFillProgress(batchId, delta, getPass())
  }
  return {
    add(delta: { filled: number; skipped: number; failed: number; unsupported: number }) {
      pending.filled += delta.filled
      pending.skipped += delta.skipped
      pending.failed += delta.failed
      pending.unsupported += delta.unsupported
      if (timer === null) {
        timer = window.setTimeout(flushInner, PROGRESS_BATCH_MS)
      }
    },
    flush() {
      if (timer !== null) {
        window.clearTimeout(timer)
        timer = null
      }
      flushInner()
    },
  }
}

let currentBatchId: string | null = null

const collectFillableFields = (container?: HTMLElement): BaseField[] =>
  Array.from(fieldRegistry.values()).filter((field) => {
    if (!isAttached(field.element)) return false
    if (!field.isFillable()) return false
    if (!field.isDisplayed()) return false
    if (container && !composedContains(container, field.element)) return false
    return true
  })

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => window.setTimeout(r, ms))

type SinglePassOutcome = {
  passedUuids: Set<string>
  counts: FillCounts
}

const liveFieldPeers = (): BaseField[] =>
  Array.from(fieldRegistry.values()).filter((peer) => isAttached(peer.element) && peer.isDisplayed())

const runSinglePass = async (
  batchId: string,
  fields: BaseField[],
  emitter: ReturnType<typeof createProgressEmitter> | null,
  attachedFiles: FileAttachLedger,
): Promise<SinglePassOutcome> => {
  const counts: FillCounts = {
    failed: 0,
    filled: 0,
    skipped: 0,
    unsupported: 0,
  }
  const passedUuids = new Set<string>()

  if (fields.length === 0) return { counts, passedUuids }

  const requests = fields.map((field) => ({
    fieldName: field.fieldName,
    fieldType: field.fieldType,
    requestId: field.uuid,
    section: field.section,
  }))

  const resolved = await requestFillValues(batchId, requests)

  for (const field of fields) {
    if (!isAttached(field.element)) {
      counts.skipped++
      emitter?.add({ failed: 0, filled: 0, skipped: 1, unsupported: 0 })
      passedUuids.add(field.uuid)
      field.recordResolverOutcome('skipped')
      continue
    }
    if (!field.isDisplayed()) {
      counts.skipped++
      emitter?.add({ failed: 0, filled: 0, skipped: 1, unsupported: 0 })
      passedUuids.add(field.uuid)
      field.recordResolverOutcome('skipped')
      continue
    }

    const result: FillValueResult = resolved.get(field.uuid) ?? {
      matchedAnswerId: null,
      profileField: null,
      requestId: field.uuid,
      value: { kind: 'unsupported' },
    }
    const value: ProfileValue = result.value
    const profileField: string | null = result.profileField
    const matchedAnswerId: string | null = result.matchedAnswerId

    const isFile = value.kind === 'file'
    if (isFile && attachedFiles.claimed(field)) {
      counts.skipped++
      emitter?.add({ failed: 0, filled: 0, skipped: 1, unsupported: 0 })
      field.recordResolverOutcome('skipped', profileField)
      passedUuids.add(field.uuid)
      continue
    }

    try {
      const outcome: FillOutcome = await field.fillFromResolved(value, false)
      if (isFile && outcome.status === 'filled') attachedFiles.record(field, liveFieldPeers())
      if (outcome.status === 'filled') {
        counts.filled++
        emitter?.add({ failed: 0, filled: 1, skipped: 0, unsupported: 0 })
        if (matchedAnswerId) {
          field.recordLearnedAnswerFill(matchedAnswerId)
        }
        field.recordResolverOutcome('filled', profileField)
      } else if (outcome.status === 'skipped') {
        counts.skipped++
        emitter?.add({ failed: 0, filled: 0, skipped: 1, unsupported: 0 })
        field.recordResolverOutcome('skipped', profileField)
      } else if (outcome.status === 'unsupported') {
        counts.unsupported++
        emitter?.add({ failed: 0, filled: 0, skipped: 0, unsupported: 1 })
        field.markUnsupportedForCapture()
        field.recordResolverOutcome('unsupported')
      } else {
        counts.failed++
        emitter?.add({ failed: 1, filled: 0, skipped: 0, unsupported: 0 })
        field.recordResolverOutcome('failed', profileField)
      }
    } catch (e) {
      counts.failed++
      emitter?.add({ failed: 1, filled: 0, skipped: 0, unsupported: 0 })
      field.recordResolverOutcome('failed', profileField)
      console.warn('[TP] fill failed', field.uuid, e)
    }
    passedUuids.add(field.uuid)
  }

  return { counts, passedUuids }
}

const fillAll = async (
  batchId: string,
  container?: HTMLElement,
  emitToBackground = true,
): Promise<FillCounts> => {
  if (currentMode === 'notesOnly') {
    const empty: FillCounts = {
      failed: 0,
      filled: 0,
      skipped: 0,
      unsupported: 0,
    }
    if (emitToBackground) {
      emitFillStarted(batchId, 0, 1)
      emitFillResult(batchId, empty, 0)
    }
    return empty
  }

  const root = container ?? detectFormContainer()
  discoverAll(root)
  sweepStaleFields()

  const initialFields = collectFillableFields(container)

  let currentPass = 1
  if (emitToBackground) emitFillStarted(batchId, initialFields.length, currentPass)

  if (initialFields.length === 0) {
    const empty: FillCounts = {
      failed: 0,
      filled: 0,
      skipped: 0,
      unsupported: 0,
    }
    if (emitToBackground) emitFillResult(batchId, empty, 0)
    return empty
  }

  const emitter = emitToBackground
    ? createProgressEmitter(batchId, () => currentPass)
    : null

  const totalCounts: FillCounts = {
    failed: 0,
    filled: 0,
    skipped: 0,
    unsupported: 0,
  }
  const everPassed = new Set<string>()
  const attachedFiles = createFileAttachLedger()

  let passes = 0
  let currentBatch = initialFields

  try {
    while (passes < MAX_FILL_PASSES && currentBatch.length > 0) {
      passes++
      currentPass = passes
      const outcome = await runSinglePass(batchId, currentBatch, emitter, attachedFiles)
      totalCounts.filled += outcome.counts.filled
      totalCounts.skipped += outcome.counts.skipped
      totalCounts.failed += outcome.counts.failed
      totalCounts.unsupported += outcome.counts.unsupported
      for (const uuid of outcome.passedUuids) everPassed.add(uuid)

      if (passes >= MAX_FILL_PASSES) break

      await sleep(REDISCOVERY_SETTLE_MS)
      discoverAll(root)
      sweepStaleFields()

      const nextFields = collectFillableFields(container).filter(
        (f) => !everPassed.has(f.uuid),
      )
      if (nextFields.length === 0) break

      currentBatch = nextFields
      currentPass = passes + 1
      if (emitToBackground) emitFillTotalIncreased(batchId, nextFields.length, currentPass)
    }
  } finally {
    emitter?.flush()
  }

  console.info('[TP] fill summary', batchId, totalCounts, 'passes', passes)
  if (emitToBackground) emitFillResult(batchId, totalCounts, passes)
  return totalCounts
}

export const fillFormContainer = async (
  batchId: string,
  container: HTMLElement,
): Promise<FillCounts> => {
  if (currentBatchId !== null) {
    return { failed: 0, filled: 0, skipped: 0, unsupported: 0 }
  }
  currentBatchId = batchId
  try {
    return await fillAll(batchId, container, false)
  } finally {
    if (currentBatchId === batchId) currentBatchId = null
  }
}

const handleFillAllRequest = (batchId: string, emit: boolean): void => {
  if (currentBatchId === batchId) return
  if (currentBatchId !== null) {
    if (emit) emitFillResult(batchId, { failed: 0, filled: 0, skipped: 0, unsupported: 0 }, 0)
    return
  }
  currentBatchId = batchId
  void fillAll(batchId, undefined, emit).finally(() => {
    if (currentBatchId === batchId) currentBatchId = null
  })
}

const describeField = (uuid: string): FieldDescriptor | null => {
  const field = fieldRegistry.get(uuid)
  if (!field || !isAttached(field.element)) return null
  return {
    fieldName: field.fieldName,
    fieldType: field.fieldType,
    fieldUuid: field.uuid,
    pickerMode: field.pickerMode,
    section: field.section,
  }
}

const fillOneField = (uuid: string, value: ProfileValue): void => {
  const field = fieldRegistry.get(uuid)
  if (!field || !isAttached(field.element)) return
  void field.fillFromResolved(value, true).catch(() => {})
}

const DISCOVER_DEBOUNCE_MS = 250
const DISCOVER_MAX_WAIT_MS = 2000
const SWEEP_DEBOUNCE_MS = 1000
const ROOT_RETARGET_DEBOUNCE_MS = 500
const FOCUS_RECOVERY_RETRY_MS = 400

const OBSERVER_OPTIONS: MutationObserverInit = {
  attributeFilter: [
    FIELD_MARKER_ATTR,
    'hidden',
    'aria-hidden',
    'aria-disabled',
    'disabled',
    'readonly',
    'inert',
  ],
  attributes: true,
  childList: true,
  subtree: true,
}

type ObserverBridge = {
  getOriginMode: typeof getOriginMode
  onBridgeMessage: typeof onBridgeMessage
}

export const startObserver = (
  bridge: ObserverBridge = { getOriginMode, onBridgeMessage },
): (() => void) => {
  let discoverTimer: number | null = null
  let discoverMaxTimer: number | null = null
  let sweepTimer: number | null = null
  let retargetTimer: number | null = null
  let focusRecoveryTimer: number | null = null
  let observer: MutationObserver | null = null
  let rootObserver: MutationObserver | null = null
  let currentTarget: HTMLElement = document.documentElement
  const shadowObserver = createShadowRootObserver(() => {
    scheduleDiscover()
    scheduleSweep()
  }, OBSERVER_OPTIONS)

  void (async () => {
    currentMode = await bridge.getOriginMode()
    setFormWidgetMode(currentMode)
    if (currentMode === 'application') {
      refreshFormWidgets()
    }
  })()

  const ensureTargetAlive = (): boolean => {
    if (currentTarget === document.documentElement) return true
    if (document.documentElement.contains(currentTarget)) return true
    startObserving(document.documentElement)
    return false
  }

  const retargetIfFormContainerAppeared = () => {
    const container = detectFormContainer()
    if (container !== currentTarget && container !== document.documentElement) {
      startObserving(container)
    }
  }

  const scheduleRetargetCheck = () => {
    if (retargetTimer !== null) return
    retargetTimer = window.setTimeout(() => {
      retargetTimer = null
      if (currentTarget === document.documentElement) {
        retargetIfFormContainerAppeared()
        return
      }
      if (!document.documentElement.contains(currentTarget)) {
        startObserving(document.documentElement)
        scheduleDiscover()
      }
    }, ROOT_RETARGET_DEBOUNCE_MS)
  }

  const runDiscoverCycle = (): void => {
    ensureTargetAlive()
    stripOrphanedMarkers()
    discoverAll(currentTarget)
    shadowObserver.sync(currentTarget)
    remountOrphanedWidgets()
    refreshFormWidgets()
  }

  const scheduleDiscover = () => {
    if (discoverTimer !== null) window.clearTimeout(discoverTimer)
    discoverTimer = window.setTimeout(() => {
      discoverTimer = null
      if (discoverMaxTimer !== null) {
        window.clearTimeout(discoverMaxTimer)
        discoverMaxTimer = null
      }
      runDiscoverCycle()
    }, DISCOVER_DEBOUNCE_MS)
    if (discoverMaxTimer === null) {
      discoverMaxTimer = window.setTimeout(() => {
        discoverMaxTimer = null
        if (discoverTimer !== null) {
          window.clearTimeout(discoverTimer)
          discoverTimer = null
        }
        runDiscoverCycle()
      }, DISCOVER_MAX_WAIT_MS)
    }
  }

  const scheduleSweep = () => {
    if (sweepTimer !== null) window.clearTimeout(sweepTimer)
    sweepTimer = window.setTimeout(() => {
      sweepTimer = null
      sweepStaleFields()
    }, SWEEP_DEBOUNCE_MS)
  }

  const startObserving = (target: HTMLElement) => {
    if (observer) observer.disconnect()
    observer = new MutationObserver(() => {
      scheduleDiscover()
      scheduleSweep()
    })
    observer.observe(target, OBSERVER_OPTIONS)
    shadowObserver.disconnect()
    shadowObserver.sync(target)
    currentTarget = target
  }

  const startRootObserver = () => {
    if (rootObserver) return
    rootObserver = new MutationObserver(() => {
      scheduleRetargetCheck()
    })
    rootObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    })
  }

  const runFocusRecovery = () => {
    sweepStaleFields()
    stripOrphanedMarkers()
    resetRemountBackoff()
    discoverAll(currentTarget)
    shadowObserver.sync(currentTarget)
    remountOrphanedWidgets()
    refreshFormWidgets()
  }

  const onWindowFocus = () => {
    runFocusRecovery()
    if (focusRecoveryTimer !== null) window.clearTimeout(focusRecoveryTimer)
    focusRecoveryTimer = window.setTimeout(() => {
      focusRecoveryTimer = null
      runFocusRecovery()
    }, FOCUS_RECOVERY_RETRY_MS)
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      runFocusRecovery()
    }
  }

  startObserving(detectFormContainer())
  startRootObserver()

  runDiscoverCycle()
  retargetIfFormContainerAppeared()

  window.addEventListener('focus', onWindowFocus)
  document.addEventListener('visibilitychange', onVisibilityChange)

  const unsubscribe = bridge.onBridgeMessage((msg) => {
    if (msg.kind === 'fill.run' && msg.requestId === null) {
      handleFillAllRequest(msg.batchId, msg.emit)
    }
    if (msg.kind === 'field.describe') {
      sendFieldDescriptor(msg.id, describeField(msg.fieldUuid))
    }
    if (msg.kind === 'field.fill') {
      fillOneField(msg.fieldUuid, msg.value)
    }
    if (msg.kind === 'mode.changed') {
      currentMode = msg.mode
      setFormWidgetMode(currentMode)
      if (currentMode === 'notesOnly') {
        destroyAllFormWidgets()
      } else {
        runDiscoverCycle()
      }
    }
  })

  return () => {
    observer?.disconnect()
    observer = null
    shadowObserver.disconnect()
    rootObserver?.disconnect()
    rootObserver = null
    window.removeEventListener('focus', onWindowFocus)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    unsubscribe()
    if (discoverTimer !== null) window.clearTimeout(discoverTimer)
    if (discoverMaxTimer !== null) window.clearTimeout(discoverMaxTimer)
    if (sweepTimer !== null) window.clearTimeout(sweepTimer)
    if (retargetTimer !== null) window.clearTimeout(retargetTimer)
    if (focusRecoveryTimer !== null) window.clearTimeout(focusRecoveryTimer)
    teardownWorkdaySections()
    destroyAllFormWidgets()
    for (const field of fieldRegistry.values()) field.destroy()
    fieldRegistry.clear()
    remountState.clear()
  }
}
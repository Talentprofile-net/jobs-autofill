import type { AtsName, FillOutcome, ProfileValue } from './types'
import type { ResolvedOriginMode } from '~/bridge/types'
import { BRIDGE_MAGIC, FIELD_MARKER_ATTR } from '~/config'
import { BaseField, isVisible } from './baseField'
import {
  getOriginMode,
  onBridgeMessage,
  resolveValuesForFields,
} from '~/bridge/mainBridge'
import { detectAts as detectAtsHost } from '~/core/ats'
import { getElement } from '~/core/getElements'
import { RegisterInputs as registerWorkday } from '~/adapters/workday'
import { RegisterInputs as registerGreenhouseClassic } from '~/adapters/greenhouseClassic'
import { RegisterInputs as registerGreenhouseReact } from '~/adapters/greenhouseReact'
import { RegisterInputs as registerGeneric } from '~/adapters/generic'
import type { FillCounts, MainWorldRequest } from '~/bridge/types'
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
}

export const getFieldByUuid = (uuid: string): BaseField | undefined =>
  fieldRegistry.get(uuid)

export const allFields = (): BaseField[] => Array.from(fieldRegistry.values())

let currentMode: ResolvedOriginMode = 'notesOnly'

export const getCurrentMode = (): ResolvedOriginMode => currentMode

const FORM_CONTAINER_XPATHS: Record<Exclude<AtsName, 'generic'>, string> = {
  workday:
    ".//div[@data-automation-id='applicationPage' or @data-automation-id='jobApplyPage' or @role='main']",
  greenhouseClassic: ".//form[@id='application_form'] | .//div[@id='application']",
  greenhouseReact:
    ".//div[contains(concat(' ', normalize-space(@class), ' '), ' application--container ')]",
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

export const discoverAll = async (
  node: Node = detectFormContainer(),
): Promise<void> => {
  const ats = detectAts()

  if (ats === 'workday') {
    await registerWorkday(node)
  } else if (ats === 'greenhouseClassic') {
    await registerGreenhouseClassic(node)
  } else if (ats === 'greenhouseReact') {
    await registerGreenhouseReact(node)
  } else {
    await registerGeneric(node)
  }
}

const sweepStaleFields = (): void => {
  for (const [uuid, field] of fieldRegistry) {
    if (!document.documentElement.contains(field.element)) {
      field.destroy()
      fieldRegistry.delete(uuid)
    }
  }
}

const postToContent = (payload: MainWorldRequest): void => {
  window.postMessage(
    { magic: BRIDGE_MAGIC, from: 'main', payload },
    window.location.origin,
  )
}

const emitFillResult = (batchId: string, counts: FillCounts): void => {
  postToContent({
    id: crypto.randomUUID(),
    kind: 'tab.fillAllResult',
    batchId,
    counts,
  })
}

const emitFillStarted = (batchId: string, total: number): void => {
  postToContent({
    id: crypto.randomUUID(),
    kind: 'tab.fillStarted',
    batchId,
    total,
  })
}

const PROGRESS_BATCH_MS = 80

const createProgressEmitter = (batchId: string) => {
  let pending: { filled: number; skipped: number; failed: number } = {
    filled: 0,
    skipped: 0,
    failed: 0,
  }
  let timer: number | null = null
  const flush = () => {
    if (pending.filled === 0 && pending.skipped === 0 && pending.failed === 0) {
      timer = null
      return
    }
    const delta = pending
    pending = { filled: 0, skipped: 0, failed: 0 }
    timer = null
    postToContent({
      id: crypto.randomUUID(),
      kind: 'tab.fillProgress',
      batchId,
      delta,
      totalDelta: 0,
    })
  }
  return {
    add(delta: { filled: number; skipped: number; failed: number }) {
      pending.filled += delta.filled
      pending.skipped += delta.skipped
      pending.failed += delta.failed
      if (timer === null) {
        timer = window.setTimeout(flush, PROGRESS_BATCH_MS)
      }
    },
    flush() {
      if (timer !== null) {
        window.clearTimeout(timer)
        timer = null
      }
      flush()
    },
  }
}

const activeBatchIds = new Set<string>()

const fillAll = async (
  batchId: string,
  container?: HTMLElement,
  emitToBackground = true,
): Promise<FillCounts> => {
  if (currentMode === 'notesOnly') {
    const empty: FillCounts = { filled: 0, skipped: 0, failed: 0 }
    if (emitToBackground) {
      emitFillStarted(batchId, 0)
      emitFillResult(batchId, empty)
    }
    return empty
  }

  const root = container ?? detectFormContainer()
  await discoverAll(root)
  sweepStaleFields()

  const liveFields = Array.from(fieldRegistry.values()).filter((field) => {
    if (!document.documentElement.contains(field.element)) return false
    if (!field.isFillable()) return false
    if (!isVisible(field.element)) return false
    if (container && !container.contains(field.element)) return false
    return true
  })

  if (emitToBackground) emitFillStarted(batchId, liveFields.length)

  if (liveFields.length === 0) {
    const empty: FillCounts = { filled: 0, skipped: 0, failed: 0 }
    if (emitToBackground) emitFillResult(batchId, empty)
    return empty
  }

  const requests = liveFields.map((field) => ({
    requestId: field.uuid,
    fieldName: field.fieldName,
    fieldType: field.fieldType,
    section: field.section,
  }))

  const resolved = await resolveValuesForFields(requests)

  let filled = 0
  let skipped = 0
  let failed = 0
  const emitter = emitToBackground ? createProgressEmitter(batchId) : null

  try {
    for (const field of liveFields) {
      if (!document.documentElement.contains(field.element)) {
        skipped++
        emitter?.add({ filled: 0, skipped: 1, failed: 0 })
        continue
      }
      if (!isVisible(field.element)) {
        skipped++
        emitter?.add({ filled: 0, skipped: 1, failed: 0 })
        continue
      }
      const value: ProfileValue =
        resolved.get(field.uuid) ?? { kind: 'unsupported' }
      try {
        const outcome: FillOutcome = await field.fillFromResolved(value, false)
        if (outcome.status === 'filled') {
          filled++
          emitter?.add({ filled: 1, skipped: 0, failed: 0 })
        } else if (outcome.status === 'skipped') {
          skipped++
          emitter?.add({ filled: 0, skipped: 1, failed: 0 })
        } else {
          failed++
          emitter?.add({ filled: 0, skipped: 0, failed: 1 })
        }
      } catch (e) {
        failed++
        emitter?.add({ filled: 0, skipped: 0, failed: 1 })
        console.warn('[TP] fill failed', field.uuid, e)
      }
    }
  } finally {
    emitter?.flush()
  }

  const counts: FillCounts = { filled, skipped, failed }
  console.info('[TP] fill summary', batchId, counts)
  if (emitToBackground) emitFillResult(batchId, counts)
  return counts
}

export const fillFormContainer = async (
  container: HTMLElement,
): Promise<FillCounts> => {
  const batchId = crypto.randomUUID()
  if (activeBatchIds.size > 0) {
    return { filled: 0, skipped: 0, failed: 0 }
  }
  activeBatchIds.add(batchId)
  try {
    return await fillAll(batchId, container, false)
  } finally {
    activeBatchIds.delete(batchId)
  }
}

const handleFillAllRequest = (batchId: string): void => {
  if (activeBatchIds.has(batchId)) return
  if (activeBatchIds.size > 0) {
    console.warn('[TP] fill already in progress; ignoring new batch', batchId)
    emitFillResult(batchId, { filled: 0, skipped: 0, failed: 0 })
    return
  }
  activeBatchIds.add(batchId)
  void fillAll(batchId, undefined, true).finally(() => {
    activeBatchIds.delete(batchId)
  })
}

const handleHotkeyFillAll = (): void => {
  if (currentMode === 'notesOnly') return
  const batchId = crypto.randomUUID()
  handleFillAllRequest(batchId)
}

const handleHotkeyOpenPicker = async (): Promise<void> => {
  const active = document.activeElement as HTMLElement | null
  if (!active) return
  const fieldHost = active.closest<HTMLElement>(`[${FIELD_MARKER_ATTR}]`)
  if (!fieldHost) return
  const uuid = fieldHost.getAttribute(FIELD_MARKER_ATTR)
  if (!uuid) return
  const field = fieldRegistry.get(uuid)
  if (!field) return
  const { openPicker } = await import('~/ui/picker/pickerController')
  openPicker({
    anchor: active,
    field: field.element,
    fieldUuid: field.uuid,
    fieldName: field.fieldName,
    fieldType: field.fieldType,
    section: field.section,
    pickerMode: field.pickerMode,
  })
}

const DISCOVER_DEBOUNCE_MS = 250
const DISCOVER_MAX_WAIT_MS = 2000
const SWEEP_DEBOUNCE_MS = 1000
const ROOT_RETARGET_DEBOUNCE_MS = 500

export const startObserver = (): (() => void) => {
  let discoverTimer: number | null = null
  let discoverMaxTimer: number | null = null
  let sweepTimer: number | null = null
  let retargetTimer: number | null = null
  let observer: MutationObserver | null = null
  let rootObserver: MutationObserver | null = null
  let currentTarget: HTMLElement = document.documentElement

  void (async () => {
    currentMode = await getOriginMode()
    setFormWidgetMode(currentMode)
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
    void discoverAll(currentTarget).then(() => {
      refreshFormWidgets()
    })
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
    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        FIELD_MARKER_ATTR,
        'hidden',
        'aria-hidden',
        'aria-disabled',
        'disabled',
        'readonly',
        'class',
      ],
    })
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

  startObserving(detectFormContainer())
  startRootObserver()

  window.setTimeout(() => {
    void discoverAll(currentTarget).then(() => {
      refreshFormWidgets()
    })
    retargetIfFormContainerAppeared()
  }, 500)

  const unsubscribe = onBridgeMessage((msg) => {
    if (msg.kind === 'tab.fillAll') {
      handleFillAllRequest(msg.batchId)
    }
    if (msg.kind === 'mode.changed') {
      currentMode = msg.mode
      setFormWidgetMode(currentMode)
      if (currentMode === 'notesOnly') {
        destroyAllFormWidgets()
      } else {
        refreshFormWidgets()
      }
    }
    if (msg.kind === 'cmd.openPicker') {
      void handleHotkeyOpenPicker()
    }
    if (msg.kind === 'cmd.fillAllHotkey') {
      handleHotkeyFillAll()
    }
  })

  return () => {
    observer?.disconnect()
    observer = null
    rootObserver?.disconnect()
    rootObserver = null
    unsubscribe()
    if (discoverTimer !== null) window.clearTimeout(discoverTimer)
    if (discoverMaxTimer !== null) window.clearTimeout(discoverMaxTimer)
    if (sweepTimer !== null) window.clearTimeout(sweepTimer)
    if (retargetTimer !== null) window.clearTimeout(retargetTimer)
    destroyAllFormWidgets()
    for (const field of fieldRegistry.values()) field.destroy()
    fieldRegistry.clear()
  }
}
import { BRIDGE_MAGIC } from '~/config'
import type {
  BackgroundResponse,
  ContentScriptRequest,
  ContentToBackground,
  MainWorldRequest,
  AuthStatus,
  ProfileSummary,
  ResolvedOriginMode,
} from './types'
import type { Profile, ProfileNote } from '~/api/types'
import type { AtsName } from '~/field/types'
import { browser } from 'wxt/browser'

type Envelope<T> = {
  magic: typeof BRIDGE_MAGIC
  from: 'content' | 'main'
  payload: T
}

const MAIN_WORLD_READY_TIMEOUT_MS = 10_000
const MAIN_WORLD_PING_INTERVAL_MS = 100

const sendFromContent = (payload: ContentScriptRequest): void => {
  const envelope: Envelope<ContentScriptRequest> = {
    magic: BRIDGE_MAGIC,
    from: 'content',
    payload,
  }
  window.postMessage(envelope, window.location.origin)
}

const isFromMain = (data: unknown): data is Envelope<MainWorldRequest> => {
  if (!data || typeof data !== 'object') return false
  const env = data as Envelope<MainWorldRequest>
  return env.magic === BRIDGE_MAGIC && env.from === 'main'
}

const sendToBackground = async <T = unknown>(
  message: ContentToBackground,
): Promise<BackgroundResponse<T>> => {
  try {
    const res = (await browser.runtime.sendMessage(message)) as BackgroundResponse<T>
    return res ?? { ok: false, error: 'no response' }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

type MainWorldGate = {
  send: (msg: ContentScriptRequest) => void
  markReady: () => void
  destroy: () => void
}

const createMainWorldGate = (): MainWorldGate => {
  let ready = false
  let destroyed = false
  const queue: ContentScriptRequest[] = []

  const flushQueue = (): void => {
    while (queue.length > 0) {
      const msg = queue.shift()
      if (msg) sendFromContent(msg)
    }
  }

  const send = (msg: ContentScriptRequest): void => {
    if (destroyed) return
    if (ready) {
      sendFromContent(msg)
    } else {
      queue.push(msg)
    }
  }

  const markReady = (): void => {
    if (ready) return
    ready = true
    flushQueue()
  }

  let elapsed = 0
  let interval = MAIN_WORLD_PING_INTERVAL_MS
  let pingTimer: number | null = null

  const scheduleNextPing = () => {
    if (destroyed || ready) return
    if (elapsed >= MAIN_WORLD_READY_TIMEOUT_MS) {
      console.warn('[TP] main-world failed to load within timeout')
      return
    }
    pingTimer = window.setTimeout(() => {
      if (destroyed || ready) return
      sendFromContent({ id: crypto.randomUUID(), kind: 'mainWorld.ping' })
      elapsed += interval
      interval = Math.min(interval * 2, 1000)
      scheduleNextPing()
    }, interval)
  }
  scheduleNextPing()

  return {
    send,
    markReady,
    destroy: () => {
      destroyed = true
      if (pingTimer !== null) window.clearTimeout(pingTimer)
      queue.length = 0
    },
  }
}

let bridgeStarted = false

export const startContentBridge = (ats: AtsName): void => {
  if (bridgeStarted) return
  bridgeStarted = true

  const gate = createMainWorldGate()

  sendToBackground({
    kind: 'frame.register',
    ats,
    url: window.location.href,
  }).catch(() => {})

  const messageHandler = async (event: MessageEvent): Promise<void> => {
    if (event.source !== window) return
    if (event.origin !== window.location.origin) return
    if (!isFromMain(event.data)) return

    const msg = event.data.payload

    if (msg.kind === 'mainWorld.ready') {
      gate.markReady()
      return
    }

    if (msg.kind === 'resolveFieldValue') {
      const res = await sendToBackground<import('~/field/types').ProfileValue>({
        kind: 'resolve',
        fieldName: msg.fieldName,
        fieldType: msg.fieldType,
        section: msg.section,
      })
      sendFromContent({
        id: msg.id,
        kind: 'fieldValueResult',
        value: res.ok && res.data ? res.data : { kind: 'unsupported' },
        error: res.ok ? undefined : res.error,
      })
      return
    }

    if (msg.kind === 'resolveFieldValues') {
      const res = await sendToBackground<
        { requestId: string; value: import('~/field/types').ProfileValue }[]
      >({
        kind: 'resolveMany',
        fields: msg.fields,
      })
      sendFromContent({
        id: msg.id,
        kind: 'fieldValuesResult',
        values: res.ok && res.data ? res.data : [],
        error: res.ok ? undefined : res.error,
      })
      return
    }

    if (msg.kind === 'tab.fillStarted') {
      await sendToBackground({
        kind: 'frame.fillStarted',
        batchId: msg.batchId,
        total: msg.total,
      })
      return
    }

    if (msg.kind === 'tab.fillProgress') {
      await sendToBackground({
        kind: 'frame.fillProgress',
        batchId: msg.batchId,
        delta: msg.delta,
        totalDelta: msg.totalDelta,
      })
      return
    }

    if (msg.kind === 'tab.fillAllResult') {
      await sendToBackground({
        kind: 'frame.fillResult',
        batchId: msg.batchId,
        counts: msg.counts,
      })
      return
    }

    if (msg.kind === 'auth.requestSignIn') {
      await sendToBackground({ kind: 'auth.openConnectPage' })
      return
    }

    if (msg.kind === 'auth.openDashboard') {
      await sendToBackground({ kind: 'auth.openDashboard' })
      return
    }

    if (msg.kind === 'auth.getStatus') {
      const res = await sendToBackground<AuthStatus>({ kind: 'auth.status' })
      sendFromContent({
        id: msg.id,
        kind: 'auth.statusResult',
        status:
          res.ok && res.data
            ? res.data
            : { authenticated: false, reason: 'network-error' },
      })
      return
    }

    if (msg.kind === 'auth.getSummary') {
      const res = await sendToBackground<ProfileSummary>({
        kind: 'profile.summary',
      })
      sendFromContent({
        id: msg.id,
        kind: 'auth.summaryResult',
        summary: res.ok && res.data ? res.data : null,
      })
      return
    }

    if (msg.kind === 'auth.getProfile') {
      const res = await sendToBackground<Profile>({
        kind: 'profile.get',
      })
      sendFromContent({
        id: msg.id,
        kind: 'auth.profileResult',
        profile: res.ok && res.data ? res.data : null,
      })
      return
    }

    if (msg.kind === 'note.create') {
      const res = await sendToBackground<ProfileNote>({
        kind: 'note.create',
        content: msg.content,
      })
      sendFromContent({
        id: msg.id,
        kind: 'note.createResult',
        error: res.ok ? undefined : res.error,
        note: res.ok && res.data ? res.data : null,
      })
      return
    }

    if (msg.kind === 'note.update') {
      const res = await sendToBackground<ProfileNote>({
        kind: 'note.update',
        noteId: msg.noteId,
        content: msg.content,
      })
      sendFromContent({
        id: msg.id,
        kind: 'note.updateResult',
        error: res.ok ? undefined : res.error,
        note: res.ok && res.data ? res.data : null,
      })
      return
    }

    if (msg.kind === 'note.delete') {
      const res = await sendToBackground<{ id: string }>({
        kind: 'note.delete',
        noteId: msg.noteId,
      })
      sendFromContent({
        id: msg.id,
        kind: 'note.deleteResult',
        error: res.ok ? undefined : res.error,
        noteId: res.ok ? msg.noteId : null,
      })
      return
    }

    if (msg.kind === 'note.touch') {
      const res = await sendToBackground({
        kind: 'note.touch',
        noteId: msg.noteId,
      })
      sendFromContent({
        id: msg.id,
        kind: 'note.touchResult',
        ok: res.ok,
        error: res.ok ? undefined : res.error,
      })
      return
    }

    if (msg.kind === 'mode.get') {
      const res = await sendToBackground<ResolvedOriginMode>({
        kind: 'mode.get',
      })
      sendFromContent({
        id: msg.id,
        kind: 'mode.result',
        mode: res.ok && res.data ? res.data : 'notesOnly',
      })
      return
    }
  }

  window.addEventListener('message', (event) => {
    messageHandler(event).catch((e) => {
      console.error('[TP] contentBridge handler error', e)
    })
  })

  const runtimeListener = (message: unknown): void => {
    if (!message || typeof message !== 'object') return
    const m = message as { kind?: string; batchId?: string; mode?: ResolvedOriginMode }
    if (m.kind === 'tab.fillAll' && typeof m.batchId === 'string') {
      const id = crypto.randomUUID()
      gate.send({ id, kind: 'tab.fillAll', batchId: m.batchId })
    }
    if (m.kind === 'auth.changed') {
      ;(async () => {
        const res = await sendToBackground<AuthStatus>({ kind: 'auth.status' })
        const status: AuthStatus =
          res.ok && res.data
            ? res.data
            : { authenticated: false, reason: 'network-error' }
        gate.send({
          id: crypto.randomUUID(),
          kind: 'auth.statePushed',
          status,
        })
      })().catch((e) => {
        console.error('[TP] contentBridge auth push error', e)
      })
    }
    if (m.kind === 'mode.changed' && m.mode) {
      gate.send({
        id: crypto.randomUUID(),
        kind: 'mode.changed',
        mode: m.mode,
      })
    }
    if (m.kind === 'cmd.openPicker') {
      gate.send({ id: crypto.randomUUID(), kind: 'cmd.openPicker' })
    }
    if (m.kind === 'cmd.fillAll') {
      gate.send({ id: crypto.randomUUID(), kind: 'cmd.fillAllHotkey' })
    }
  }
  browser.runtime.onMessage.addListener(runtimeListener)

  window.addEventListener('pagehide', () => {
    gate.destroy()
    browser.runtime.onMessage.removeListener(runtimeListener)
  })
}
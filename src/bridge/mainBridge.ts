import { BRIDGE_MAGIC } from '~/config'
import type {
  ContentScriptRequest,
  FieldDescriptor,
  FieldResolveRequest,
  FillCounts,
  FillProgressDelta,
  FillValueResult,
  MainWorldRequest,
  ResolvedOriginMode,
} from './types'
import type { AnswerCaptureRecord } from './types'

type Envelope<T> = {
  magic: typeof BRIDGE_MAGIC
  from: 'content' | 'main'
  payload: T
}

type Pending = {
  resolve: (msg: ContentScriptRequest) => void
  timer: ReturnType<typeof setTimeout>
}

type Handler = (msg: ContentScriptRequest) => void

const pending = new Map<string, Pending>()
const handlers: Handler[] = []

const MODE_REQUEST_TIMEOUT_MS = 3_000
const FILL_VALUES_TIMEOUT_MS = 20_000
const FILL_GRANT_TIMEOUT_MS = 120_000

const sendFromMain = (payload: MainWorldRequest): void => {
  const envelope: Envelope<MainWorldRequest> = {
    from: 'main',
    magic: BRIDGE_MAGIC,
    payload,
  }
  window.postMessage(envelope, window.location.origin)
}

const isFromContent = (data: unknown): data is Envelope<ContentScriptRequest> => {
  if (!data || typeof data !== 'object') return false
  const env = data as Envelope<ContentScriptRequest>
  return env.magic === BRIDGE_MAGIC && env.from === 'content'
}

const pendingKey = (msg: ContentScriptRequest): string | null => {
  if (msg.kind === 'mode.result' || msg.kind === 'fill.values') return msg.id
  if (msg.kind === 'fill.denied') return msg.requestId
  if (msg.kind === 'fill.run' && msg.requestId) return msg.requestId
  return null
}

const startListener = (() => {
  let started = false
  return () => {
    if (started) return
    started = true

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return
      if (event.origin !== window.location.origin) return
      if (!isFromContent(event.data)) return

      const msg = event.data.payload

      if (msg.kind === 'mainWorld.ping') {
        sendFromMain({ id: crypto.randomUUID(), kind: 'mainWorld.ready' })
        return
      }

      const key = pendingKey(msg)
      if (key !== null) {
        const waiting = pending.get(key)
        if (waiting) {
          clearTimeout(waiting.timer)
          pending.delete(key)
          waiting.resolve(msg)
        }
        return
      }

      for (const h of handlers) h(msg)
    })

    sendFromMain({ id: crypto.randomUUID(), kind: 'mainWorld.ready' })
  }
})()

const awaitReply = (
  key: string,
  timeoutMs: number,
  send: () => void,
): Promise<ContentScriptRequest | null> => {
  startListener()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pending.delete(key)) resolve(null)
    }, timeoutMs)
    pending.set(key, { resolve, timer })
    send()
  })
}

export const postToContent = (payload: MainWorldRequest): void => {
  startListener()
  sendFromMain(payload)
}

export const onBridgeMessage = (handler: Handler): (() => void) => {
  startListener()
  handlers.push(handler)
  return () => {
    const idx = handlers.indexOf(handler)
    if (idx >= 0) handlers.splice(idx, 1)
  }
}

export const getOriginMode = async (): Promise<ResolvedOriginMode> => {
  const id = crypto.randomUUID()
  const reply = await awaitReply(id, MODE_REQUEST_TIMEOUT_MS, () =>
    sendFromMain({ id, kind: 'mode.get' }),
  )
  return reply?.kind === 'mode.result' ? reply.mode : 'notesOnly'
}

export const requestFillValues = async (
  batchId: string,
  fields: (FieldResolveRequest & { requestId: string })[],
): Promise<Map<string, FillValueResult>> => {
  const id = crypto.randomUUID()
  const reply = await awaitReply(id, FILL_VALUES_TIMEOUT_MS, () =>
    sendFromMain({ batchId, fields, id, kind: 'fill.fields' }),
  )
  const wanted = new Set(fields.map((f) => f.requestId))
  const out = new Map<string, FillValueResult>()
  if (reply?.kind === 'fill.values' && reply.batchId === batchId) {
    for (const result of reply.results) {
      if (wanted.has(result.requestId)) out.set(result.requestId, result)
    }
  }
  for (const f of fields) {
    if (!out.has(f.requestId)) {
      out.set(f.requestId, {
        matchedAnswerId: null,
        profileField: null,
        requestId: f.requestId,
        value: reply ? { kind: 'unsupported' } : { kind: 'timeout' },
      })
    }
  }
  return out
}

export type FillGrant =
  | { kind: 'run'; batchId: string; lowScore: boolean }
  | { kind: 'signin' }
  | { kind: 'none' }

export const requestFillGrant = async (): Promise<FillGrant> => {
  const id = crypto.randomUUID()
  const reply = await awaitReply(id, FILL_GRANT_TIMEOUT_MS, () =>
    sendFromMain({ id, kind: 'fill.request' }),
  )
  if (reply?.kind === 'fill.run') {
    return { batchId: reply.batchId, kind: 'run', lowScore: reply.lowScore }
  }
  if (reply?.kind === 'fill.denied' && reply.reason === 'signin') return { kind: 'signin' }
  return { kind: 'none' }
}

export const requestOpenDashboard = (): void => {
  postToContent({ id: crypto.randomUUID(), kind: 'widget.openDashboard' })
}

export const sendFieldDescriptor = (id: string, descriptor: FieldDescriptor | null): void => {
  postToContent({ descriptor, id, kind: 'field.descriptor' })
}

export const submitCapture = (records: AnswerCaptureRecord[]): void => {
  postToContent({ id: crypto.randomUUID(), kind: 'capture.submit', records })
}

export const emitFillStarted = (batchId: string, total: number, pass: number): void =>
  postToContent({ batchId, id: crypto.randomUUID(), kind: 'fill.started', pass, total })

export const emitFillProgress = (batchId: string, delta: FillProgressDelta, pass: number): void =>
  postToContent({
    batchId,
    delta,
    id: crypto.randomUUID(),
    kind: 'fill.progress',
    pass,
    totalDelta: 0,
  })

export const emitFillTotalIncreased = (batchId: string, addedTotal: number, pass: number): void =>
  postToContent({ addedTotal, batchId, id: crypto.randomUUID(), kind: 'fill.totalIncreased', pass })

export const emitFillResult = (batchId: string, counts: FillCounts, passes: number): void =>
  postToContent({ batchId, counts, id: crypto.randomUUID(), kind: 'fill.result', passes })

export type { FieldResolveRequest } from './types'

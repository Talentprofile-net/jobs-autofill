import { BRIDGE_MAGIC } from '~/config'
import type { Profile, ProfileNote } from '~/api/types'
import type { ProfileValue } from '~/field/types'
import type {
  AuthStatus,
  ContentScriptRequest,
  FieldResolveRequest,
  MainWorldRequest,
  ProfileSummary,
  ResolvedOriginMode,
} from './types'

type Envelope<T> = {
  magic: typeof BRIDGE_MAGIC
  from: 'content' | 'main'
  payload: T
}

type PendingRequest = {
  resolve: (value: ContentScriptRequest) => void
  timer: ReturnType<typeof setTimeout>
}

const pending = new Map<string, PendingRequest>()
type Handler = (msg: ContentScriptRequest) => void
const handlers: Handler[] = []

const REQUEST_TIMEOUT_MS = 10_000
const BATCH_TIMEOUT_MS = 15_000
const AUTH_REQUEST_TIMEOUT_MS = 5_000
const NOTE_OP_TIMEOUT_MS = 10_000
const MODE_REQUEST_TIMEOUT_MS = 3_000

const sendFromMain = (payload: MainWorldRequest): void => {
  const envelope: Envelope<MainWorldRequest> = {
    magic: BRIDGE_MAGIC,
    from: 'main',
    payload,
  }
  window.postMessage(envelope, window.location.origin)
}

const isFromContent = (data: unknown): data is Envelope<ContentScriptRequest> => {
  if (!data || typeof data !== 'object') return false
  const env = data as Envelope<ContentScriptRequest>
  return env.magic === BRIDGE_MAGIC && env.from === 'content'
}

const announceReady = (): void => {
  sendFromMain({ id: crypto.randomUUID(), kind: 'mainWorld.ready' })
}

const startListener = (() => {
  let started = false
  return () => {
    if (started) return
    started = true

    announceReady()

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return
      if (event.origin !== window.location.origin) return
      if (!isFromContent(event.data)) return

      const msg = event.data.payload

      if (msg.kind === 'mainWorld.ping') {
        announceReady()
        return
      }

      if (
        msg.kind === 'fieldValueResult' ||
        msg.kind === 'fieldValuesResult' ||
        msg.kind === 'auth.statusResult' ||
        msg.kind === 'auth.summaryResult' ||
        msg.kind === 'auth.profileResult' ||
        msg.kind === 'note.createResult' ||
        msg.kind === 'note.updateResult' ||
        msg.kind === 'note.deleteResult' ||
        msg.kind === 'note.touchResult' ||
        msg.kind === 'mode.result'
      ) {
        const pendingReq = pending.get(msg.id)
        if (pendingReq) {
          clearTimeout(pendingReq.timer)
          pending.delete(msg.id)
          pendingReq.resolve(msg)
        }
        return
      }

      if (
        msg.kind === 'auth.statePushed' ||
        msg.kind === 'mode.changed' ||
        msg.kind === 'cmd.openPicker' ||
        msg.kind === 'cmd.fillAllHotkey' ||
        msg.kind === 'tab.fillAll'
      ) {
        for (const h of handlers) h(msg)
        return
      }
    })
  }
})()

const sendRequest = <T extends ContentScriptRequest>(
  message: MainWorldRequest,
  timeoutMs: number,
  extract: (msg: ContentScriptRequest) => T | null,
  fallback: T,
): Promise<T> => {
  startListener()
  const id = message.id
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        resolve(fallback)
      }
    }, timeoutMs)
    pending.set(id, {
      timer,
      resolve: (msg) => {
        const v = extract(msg)
        resolve(v ?? fallback)
      },
    })
    sendFromMain(message)
  })
}

export const resolveValueForField = async (
  fieldName: string,
  fieldType: string,
  section: string,
): Promise<ProfileValue> => {
  const id = crypto.randomUUID()
  const result = await sendRequest(
    { id, kind: 'resolveFieldValue', fieldName, fieldType, section },
    REQUEST_TIMEOUT_MS,
    (msg) =>
      msg.kind === 'fieldValueResult'
        ? ({ id: msg.id, kind: msg.kind, value: msg.value } as any)
        : null,
    { id, kind: 'fieldValueResult', value: { kind: 'timeout' } } as any,
  )
  return (result as any).value as ProfileValue
}

export const resolveValuesForFields = async (
  fields: FieldResolveRequest[],
): Promise<Map<string, ProfileValue>> => {
  startListener()
  const id = crypto.randomUUID()
  const tagged = fields.map((f) => ({
    ...f,
    requestId: f.requestId ?? crypto.randomUUID(),
  }))
  const requestIdSet: Set<string> = new Set(tagged.map((t) => t.requestId))
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        const fallback = new Map<string, ProfileValue>()
        for (const t of tagged) fallback.set(t.requestId, { kind: 'timeout' })
        resolve(fallback)
      }
    }, BATCH_TIMEOUT_MS)
    pending.set(id, {
      timer,
      resolve: (msg) => {
        const out = new Map<string, ProfileValue>()
        if (msg.kind === 'fieldValuesResult') {
          for (const v of msg.values) {
            if (requestIdSet.has(v.requestId)) {
              out.set(v.requestId, v.value)
            }
          }
        }
        for (const t of tagged) {
          if (!out.has(t.requestId)) out.set(t.requestId, { kind: 'unsupported' })
        }
        resolve(out)
      },
    })
    sendFromMain({
      id,
      kind: 'resolveFieldValues',
      fields: tagged,
    })
  })
}

export const onBridgeMessage = (handler: Handler): (() => void) => {
  startListener()
  handlers.push(handler)
  return () => {
    const idx = handlers.indexOf(handler)
    if (idx >= 0) handlers.splice(idx, 1)
  }
}

export const requestSignIn = (): void => {
  startListener()
  sendFromMain({ id: crypto.randomUUID(), kind: 'auth.requestSignIn' })
}

export const openDashboard = (): void => {
  startListener()
  sendFromMain({ id: crypto.randomUUID(), kind: 'auth.openDashboard' })
}

export const getAuthStatus = async (): Promise<AuthStatus> => {
  const id = crypto.randomUUID()
  const result = await sendRequest(
    { id, kind: 'auth.getStatus' },
    AUTH_REQUEST_TIMEOUT_MS,
    (msg) =>
      msg.kind === 'auth.statusResult'
        ? ({ id: msg.id, kind: msg.kind, status: msg.status } as any)
        : null,
    {
      id,
      kind: 'auth.statusResult',
      status: { authenticated: false, reason: 'network-error' },
    } as any,
  )
  return (result as any).status
}

export const getProfileSummary = async (): Promise<ProfileSummary | null> => {
  const id = crypto.randomUUID()
  const result = await sendRequest(
    { id, kind: 'auth.getSummary' },
    AUTH_REQUEST_TIMEOUT_MS,
    (msg) =>
      msg.kind === 'auth.summaryResult'
        ? ({ id: msg.id, kind: msg.kind, summary: msg.summary } as any)
        : null,
    { id, kind: 'auth.summaryResult', summary: null } as any,
  )
  return (result as any).summary
}

export const getProfile = async (): Promise<Profile | null> => {
  const id = crypto.randomUUID()
  const result = await sendRequest(
    { id, kind: 'auth.getProfile' },
    AUTH_REQUEST_TIMEOUT_MS,
    (msg) =>
      msg.kind === 'auth.profileResult'
        ? ({ id: msg.id, kind: msg.kind, profile: msg.profile } as any)
        : null,
    { id, kind: 'auth.profileResult', profile: null } as any,
  )
  return (result as any).profile
}

export const createNote = async (
  content: string,
): Promise<{ note: ProfileNote | null; error?: string }> => {
  const id = crypto.randomUUID()
  const result = await sendRequest(
    { id, kind: 'note.create', content },
    NOTE_OP_TIMEOUT_MS,
    (msg) =>
      msg.kind === 'note.createResult'
        ? ({ id: msg.id, kind: msg.kind, note: msg.note, error: msg.error } as any)
        : null,
    { id, kind: 'note.createResult', note: null, error: 'Timed out' } as any,
  )
  return { note: (result as any).note, error: (result as any).error }
}

export const updateNote = async (
  noteId: string,
  content: string,
): Promise<{ note: ProfileNote | null; error?: string }> => {
  const id = crypto.randomUUID()
  const result = await sendRequest(
    { id, kind: 'note.update', noteId, content },
    NOTE_OP_TIMEOUT_MS,
    (msg) =>
      msg.kind === 'note.updateResult'
        ? ({ id: msg.id, kind: msg.kind, note: msg.note, error: msg.error } as any)
        : null,
    { id, kind: 'note.updateResult', note: null, error: 'Timed out' } as any,
  )
  return { note: (result as any).note, error: (result as any).error }
}

export const deleteNote = async (
  noteId: string,
): Promise<{ deletedId: string | null; error?: string }> => {
  const id = crypto.randomUUID()
  const result = await sendRequest(
    { id, kind: 'note.delete', noteId },
    NOTE_OP_TIMEOUT_MS,
    (msg) =>
      msg.kind === 'note.deleteResult'
        ? ({
            id: msg.id,
            kind: msg.kind,
            noteId: msg.noteId,
            error: msg.error,
          } as any)
        : null,
    { id, kind: 'note.deleteResult', noteId: null, error: 'Timed out' } as any,
  )
  return {
    deletedId: (result as any).noteId,
    error: (result as any).error,
  }
}

export const touchNote = async (
  noteId: string,
): Promise<{ ok: boolean; error?: string }> => {
  const id = crypto.randomUUID()
  const result = await sendRequest(
    { id, kind: 'note.touch', noteId },
    NOTE_OP_TIMEOUT_MS,
    (msg) =>
      msg.kind === 'note.touchResult'
        ? ({ id: msg.id, kind: msg.kind, ok: msg.ok, error: msg.error } as any)
        : null,
    { id, kind: 'note.touchResult', ok: false, error: 'Timed out' } as any,
  )
  return { ok: (result as any).ok, error: (result as any).error }
}

export const getOriginMode = async (): Promise<ResolvedOriginMode> => {
  const id = crypto.randomUUID()
  const result = await sendRequest(
    { id, kind: 'mode.get' },
    MODE_REQUEST_TIMEOUT_MS,
    (msg) =>
      msg.kind === 'mode.result'
        ? ({ id: msg.id, kind: msg.kind, mode: msg.mode } as any)
        : null,
    { id, kind: 'mode.result', mode: 'notesOnly' } as any,
  )
  return (result as any).mode
}

export type { FieldResolveRequest } from './types'
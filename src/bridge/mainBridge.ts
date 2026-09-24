import { BRIDGE_MAGIC } from '~/config'
import type { Profile, ProfileNote } from '~/api/types'
import type { ProfileValue } from '~/field/types'
import type { AtsName } from '~/field/types'
import type {
  AuthStatus,
  CaptureStagePayload,
  ContentScriptRequest,
  FieldResolveRequest,
  FieldResolveResult,
  MainWorldRequest,
  ProfileSummary,
  ResolvedOriginMode,
} from './types'
import type { LearnedAnswerResult } from '~/resolver/learnedAnswers'
import type { SuggestionRequest } from '~/classifier/suggest'
import type { SuggestionRow } from '~/classifier/suggestClient'

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
const LEARNED_BATCH_TIMEOUT_MS = 8_000
const FLUSH_TIMEOUT_MS = 15_000
const SUGGEST_TIMEOUT_MS = 60_000

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
        msg.kind === 'mode.result' ||
        msg.kind === 'learnedAnswersResult' ||
        msg.kind === 'classifier.suggestResult' ||
        msg.kind === 'answers.stageResult' ||
        msg.kind === 'answers.commitResult' ||
        msg.kind === 'answers.discardResult'
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

    sendFromMain({ id: crypto.randomUUID(), kind: 'mainWorld.ready' })
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
      resolve: (msg) => {
        const v = extract(msg)
        resolve(v ?? fallback)
      },
      timer,
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
    { fieldName, fieldType, id, kind: 'resolveFieldValue', section },
    REQUEST_TIMEOUT_MS,
    (msg) =>
      msg.kind === 'fieldValueResult'
        ? ({ id: msg.id, kind: msg.kind, profileField: msg.profileField, value: msg.value } as any)
        : null,
    { id, kind: 'fieldValueResult', profileField: null, value: { kind: 'timeout' } } as any,
  )
  return (result as any).value as ProfileValue
}

export const resolveValuesForFields = async (
  fields: FieldResolveRequest[],
): Promise<Map<string, FieldResolveResult>> => {
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
        const fallback = new Map<string, FieldResolveResult>()
        for (const t of tagged) {
          fallback.set(t.requestId, {
            profileField: null,
            requestId: t.requestId,
            value: { kind: 'timeout' },
          })
        }
        resolve(fallback)
      }
    }, BATCH_TIMEOUT_MS)
    pending.set(id, {
      resolve: (msg) => {
        const out = new Map<string, FieldResolveResult>()
        if (msg.kind === 'fieldValuesResult') {
          for (const v of msg.values) {
            if (requestIdSet.has(v.requestId)) {
              out.set(v.requestId, v)
            }
          }
        }
        for (const t of tagged) {
          if (!out.has(t.requestId)) {
            out.set(t.requestId, {
              profileField: null,
              requestId: t.requestId,
              value: { kind: 'unsupported' },
            })
          }
        }
        resolve(out)
      },
      timer,
    })
    sendFromMain({
      fields: tagged,
      id,
      kind: 'resolveFieldValues',
    })
  })
}

export const requestClassifierSuggestion = async (
  request: SuggestionRequest,
): Promise<SuggestionRow | null> => {
  const id = crypto.randomUUID()
  const result = await sendRequest<ContentScriptRequest>(
    { id, kind: 'classifier.suggest', request },
    SUGGEST_TIMEOUT_MS,
    (msg) => (msg.kind === 'classifier.suggestResult' ? msg : null),
    { id, kind: 'classifier.suggestResult', row: null },
  )
  return result.kind === 'classifier.suggestResult' ? result.row : null
}

export const resolveLearnedAnswersBatchViaBridge = async (
  fields: Array<{
    requestId: string
    fieldName: string
    fieldType: string
    section: string
  }>,
): Promise<LearnedAnswerResult[]> => {
  startListener()
  const id = crypto.randomUUID()
  return new Promise<LearnedAnswerResult[]>((resolve) => {
    const timer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        resolve(
          fields.map((f) => ({
            matchedAnswerId: null,
            requestId: f.requestId,
            value: { kind: 'timeout' as const },
          })),
        )
      }
    }, LEARNED_BATCH_TIMEOUT_MS)
    pending.set(id, {
      resolve: (msg) => {
        if (msg.kind === 'learnedAnswersResult') {
          const requestIdSet = new Set(fields.map((f) => f.requestId))
          const out: LearnedAnswerResult[] = []
          for (const r of msg.results) {
            if (requestIdSet.has(r.requestId)) out.push(r)
          }
          const seen = new Set(out.map((r) => r.requestId))
          for (const f of fields) {
            if (!seen.has(f.requestId)) {
              out.push({
                matchedAnswerId: null,
                requestId: f.requestId,
                value: { kind: 'unsupported' as const },
              })
            }
          }
          resolve(out)
        } else {
          resolve(
            fields.map((f) => ({
              matchedAnswerId: null,
              requestId: f.requestId,
              value: { kind: 'unsupported' as const },
            })),
          )
        }
      },
      timer,
    })
    sendFromMain({ fields, id, kind: 'resolveLearnedAnswers' })
  })
}

export const stageCaptureViaBridge = async (
  payload: CaptureStagePayload,
): Promise<{ ok: boolean; stageId?: string; error?: string }> => {
  const id = crypto.randomUUID()
  const result = await sendRequest(
    { id, kind: 'answers.stage', payload },
    FLUSH_TIMEOUT_MS,
    (msg) =>
      msg.kind === 'answers.stageResult'
        ? ({
            error: msg.error,
            id: msg.id,
            kind: msg.kind,
            ok: msg.ok,
            stageId: msg.stageId,
          } as any)
        : null,
    { error: 'Timed out', id, kind: 'answers.stageResult', ok: false } as any,
  )
  return {
    error: (result as any).error,
    ok: (result as any).ok,
    stageId: (result as any).stageId,
  }
}

export const commitCaptureViaBridge = async (
  stageId: string,
): Promise<{ ok: boolean; error?: string }> => {
  const id = crypto.randomUUID()
  const result = await sendRequest(
    { id, kind: 'answers.commit', stageId },
    FLUSH_TIMEOUT_MS,
    (msg) =>
      msg.kind === 'answers.commitResult'
        ? ({ error: msg.error, id: msg.id, kind: msg.kind, ok: msg.ok } as any)
        : null,
    { error: 'Timed out', id, kind: 'answers.commitResult', ok: false } as any,
  )
  return { error: (result as any).error, ok: (result as any).ok }
}

export const discardCaptureViaBridge = async (
  stageId: string,
  outcome: 'failure' | 'unknown',
): Promise<{ ok: boolean }> => {
  const id = crypto.randomUUID()
  const result = await sendRequest(
    { id, kind: 'answers.discard', outcome, stageId },
    FLUSH_TIMEOUT_MS,
    (msg) =>
      msg.kind === 'answers.discardResult'
        ? ({ id: msg.id, kind: msg.kind, ok: msg.ok } as any)
        : null,
    { id, kind: 'answers.discardResult', ok: false } as any,
  )
  return { ok: (result as any).ok }
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
    { content, id, kind: 'note.create' },
    NOTE_OP_TIMEOUT_MS,
    (msg) =>
      msg.kind === 'note.createResult'
        ? ({ error: msg.error, id: msg.id, kind: msg.kind, note: msg.note } as any)
        : null,
    { error: 'Timed out', id, kind: 'note.createResult', note: null } as any,
  )
  return { error: (result as any).error, note: (result as any).note }
}

export const updateNote = async (
  noteId: string,
  content: string,
): Promise<{ note: ProfileNote | null; error?: string }> => {
  const id = crypto.randomUUID()
  const result = await sendRequest(
    { content, id, kind: 'note.update', noteId },
    NOTE_OP_TIMEOUT_MS,
    (msg) =>
      msg.kind === 'note.updateResult'
        ? ({ error: msg.error, id: msg.id, kind: msg.kind, note: msg.note } as any)
        : null,
    { error: 'Timed out', id, kind: 'note.updateResult', note: null } as any,
  )
  return { error: (result as any).error, note: (result as any).note }
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
            error: msg.error,
            id: msg.id,
            kind: msg.kind,
            noteId: msg.noteId,
          } as any)
        : null,
    { error: 'Timed out', id, kind: 'note.deleteResult', noteId: null } as any,
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
        ? ({ error: msg.error, id: msg.id, kind: msg.kind, ok: msg.ok } as any)
        : null,
    { error: 'Timed out', id, kind: 'note.touchResult', ok: false } as any,
  )
  return { error: (result as any).error, ok: (result as any).ok }
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
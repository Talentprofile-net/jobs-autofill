import { browser } from 'wxt/browser'

import type { Profile, ProfileNote } from '~/api/types'
import type { AuthStatus, BackgroundResponse, ContentToBackground } from '~/bridge/types'
import type { Suggestion, SuggestionRequest } from '~/classifier/suggest'
import { requestSuggestionRow, type SuggestionRow } from '~/classifier/suggestClient'
import type { ProfileValue } from '~/field/types'
import type { InsertResult, PickerAction, PickerContextData } from './protocol'

const send = async <T = unknown>(message: ContentToBackground): Promise<BackgroundResponse<T>> => {
  try {
    const response = (await browser.runtime.sendMessage(message)) as BackgroundResponse<T> | undefined
    return response ?? { error: 'no response', ok: false }
  } catch (e) {
    return { error: (e as Error).message, ok: false }
  }
}

export const announcePickerReady = (hostId: string): void => {
  void send({ action: { type: 'ready' }, activation: null, hostId, kind: 'picker.relay' })
}

export const createPickerApi = (hostId: string, activation: string) => {
  const relay = <T = unknown>(action: PickerAction) => send<T>({ action, activation, hostId, kind: 'picker.relay' })

  return {
    authStatus: async (): Promise<AuthStatus> => {
      const res = await send<AuthStatus>({ kind: 'auth.status' })
      return res.ok && res.data ? res.data : { authenticated: false, reason: 'network-error' }
    },
    context: async (): Promise<PickerContextData | null> => {
      const res = await relay<PickerContextData>({ type: 'context' })
      return res.ok && res.data ? res.data : null
    },
    createNote: async (content: string): Promise<{ note: ProfileNote | null; error?: string }> => {
      const res = await send<ProfileNote>({ content, kind: 'note.create' })
      return res.ok ? { note: res.data ?? null } : { error: res.error, note: null }
    },
    deleteNote: async (noteId: string): Promise<{ deletedId: string | null; error?: string }> => {
      const res = await send({ kind: 'note.delete', noteId })
      return res.ok ? { deletedId: noteId } : { deletedId: null, error: res.error }
    },
    confirmFill: async (): Promise<boolean> => (await relay({ type: 'confirmFill' })).ok,
    dismiss: (): void => {
      void relay({ type: 'dismiss' })
    },
    fill: async (value: ProfileValue): Promise<void> => {
      await relay({ type: 'fill', value })
    },
    insert: async (text: string): Promise<InsertResult> => {
      const res = await relay<InsertResult>({ text, type: 'insert' })
      return res.ok && res.data ? res.data : { inserted: false, maxLength: null, truncated: false }
    },
    profile: async (): Promise<Profile | null> => {
      const res = await send<Profile>({ kind: 'profile.get' })
      return res.ok && res.data ? res.data : null
    },
    resize: (height: number): void => {
      void relay({ height, type: 'resize' })
    },
    signIn: (): void => {
      void send({ kind: 'auth.openConnectPage' })
    },
    suggest: (request: SuggestionRequest): Promise<SuggestionRow | null> =>
      requestSuggestionRow((message) => send<Suggestion>(message), browser.storage.local, request),
    touchNote: (noteId: string): void => {
      void send({ kind: 'note.touch', noteId })
    },
    updateNote: async (noteId: string, content: string): Promise<{ note: ProfileNote | null; error?: string }> => {
      const res = await send<ProfileNote>({ content, kind: 'note.update', noteId })
      return res.ok ? { note: res.data ?? null } : { error: res.error, note: null }
    },
  }
}

export type PickerApi = ReturnType<typeof createPickerApi>

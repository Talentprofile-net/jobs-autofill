import type { AtsName, OriginMode, ProfileValue } from '~/field/types'
import type { Profile, ProfileNote } from '~/api/types'

export type AuthMethod = 'local' | 'google' | 'github' | 'magic' | 'auth0' | 'email'

export type AuthFailureReason =
  | 'no-token'
  | 'expired'
  | 'refresh-failed'
  | 'network-error'

export type AuthStatus =
  | { authenticated: false; reason?: AuthFailureReason }
  | { authenticated: true; email: string | null; method: AuthMethod | null }

export type FieldResolveRequest = {
  requestId?: string
  fieldName: string
  fieldType: string
  section: string
}

export type FillCounts = {
  filled: number
  skipped: number
  failed: number
}

export type FillBatchResult = {
  counts: FillCounts
  framesTimedOut: number
  total: number
}

export type FillProgress = {
  counts: FillCounts
  total: number
}

export type FillPortIncoming =
  | { kind: 'fill.start'; tabId: number }

export type FillPortOutgoing =
  | { kind: 'fill.frame.started'; total: number }
  | { kind: 'fill.progress'; counts: FillCounts; total: number }
  | { kind: 'fill.done'; result: FillBatchResult }
  | { kind: 'fill.error'; error: string }

export type ResolvedOriginMode = 'application' | 'notesOnly'

export type MainWorldRequest =
  | {
      id: string
      kind: 'resolveFieldValue'
      fieldName: string
      fieldType: string
      section: string
    }
  | {
      id: string
      kind: 'resolveFieldValues'
      fields: (FieldResolveRequest & { requestId: string })[]
    }
  | { id: string; kind: 'mainWorld.ready' }
  | { id: string; kind: 'tab.fillAllResult'; batchId: string; counts: FillCounts }
  | { id: string; kind: 'tab.fillStarted'; batchId: string; total: number }
  | {
      id: string
      kind: 'tab.fillProgress'
      batchId: string
      delta: { filled: number; skipped: number; failed: number }
      totalDelta: number
    }
  | { id: string; kind: 'auth.requestSignIn' }
  | { id: string; kind: 'auth.getStatus' }
  | { id: string; kind: 'auth.getSummary' }
  | { id: string; kind: 'auth.getProfile' }
  | { id: string; kind: 'auth.openDashboard' }
  | { id: string; kind: 'note.create'; content: string }
  | { id: string; kind: 'note.update'; noteId: string; content: string }
  | { id: string; kind: 'note.delete'; noteId: string }
  | { id: string; kind: 'note.touch'; noteId: string }
  | { id: string; kind: 'mode.get' }

export type ContentScriptRequest =
  | { id: string; kind: 'fieldValueResult'; value: ProfileValue; error?: string }
  | {
      id: string
      kind: 'fieldValuesResult'
      values: { requestId: string; value: ProfileValue }[]
      error?: string
    }
  | { id: string; kind: 'mainWorld.ping' }
  | { id: string; kind: 'tab.fillAll'; batchId: string }
  | { id: string; kind: 'auth.statusResult'; status: AuthStatus }
  | { id: string; kind: 'auth.summaryResult'; summary: ProfileSummary | null }
  | { id: string; kind: 'auth.profileResult'; profile: Profile | null }
  | { id: string; kind: 'auth.statePushed'; status: AuthStatus }
  | { id: string; kind: 'note.createResult'; note: ProfileNote | null; error?: string }
  | { id: string; kind: 'note.updateResult'; note: ProfileNote | null; error?: string }
  | { id: string; kind: 'note.deleteResult'; noteId: string | null; error?: string }
  | { id: string; kind: 'note.touchResult'; ok: boolean; error?: string }
  | { id: string; kind: 'mode.result'; mode: ResolvedOriginMode }
  | { id: string; kind: 'mode.changed'; mode: ResolvedOriginMode }
  | { id: string; kind: 'cmd.openPicker' }
  | { id: string; kind: 'cmd.fillAllHotkey' }

export type DetectedAts = AtsName | null

export type ProfileSummary = {
  profileName: string | null
  email: string | null
  jobTitle: string | null
  profileScore: number
  scoreItems: ProfileScoreItems
}

export type ProfileScoreItems = {
  profileName: boolean
  jobTitle: boolean
  description: 'long' | 'short' | 'missing'
  location: boolean
  rate: boolean
  totalExperience: boolean
  skills: boolean
  languages: boolean
  experience: boolean
  education: boolean
}

export type PopupToBackground =
  | { kind: 'auth.logout' }
  | { kind: 'auth.status' }
  | { kind: 'profile.summary' }
  | { kind: 'profile.refresh' }
  | { kind: 'tab.detectAts'; tabId: number }
  | { kind: 'auth.openConnectPage' }
  | { kind: 'auth.cancelConnect' }
  | { kind: 'auth.changed' }
  | { kind: 'tab.listOrigins'; tabId: number }
  | { kind: 'origin.enable'; pattern: string; mode: OriginMode }
  | { kind: 'origin.disable'; pattern: string }
  | { kind: 'origin.setMode'; pattern: string; mode: OriginMode }
  | { kind: 'origin.list' }

export type ContentToBackground =
  | { kind: 'resolve'; fieldName: string; fieldType: string; section: string }
  | {
      kind: 'resolveMany'
      fields: (FieldResolveRequest & { requestId: string })[]
    }
  | { kind: 'auth.status' }
  | { kind: 'auth.openConnectPage' }
  | { kind: 'auth.openDashboard' }
  | { kind: 'profile.summary' }
  | { kind: 'profile.get' }
  | { kind: 'note.touch'; noteId: string }
  | { kind: 'note.create'; content: string }
  | { kind: 'note.update'; noteId: string; content: string }
  | { kind: 'note.delete'; noteId: string }
  | { kind: 'mode.get' }
  | { kind: 'frame.register'; ats: AtsName; url: string }
  | { kind: 'frame.fillResult'; batchId: string; counts: FillCounts }
  | { kind: 'frame.fillStarted'; batchId: string; total: number }
  | {
      kind: 'frame.fillProgress'
      batchId: string
      delta: { filled: number; skipped: number; failed: number }
      totalDelta: number
    }

export type ExternalToBackground =
  | {
      kind: 'auth.handoff'
      token: string
      refreshToken: string
      method: AuthMethod
    }
  | { kind: 'auth.ping' }

export type BackgroundResponse<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string }

export type TabOriginInfo = {
  topOrigin: string
  topPattern: string
  topEnabled: boolean
  topPermitted: boolean
  topMode: OriginMode | null
  iframeOrigins: Array<{
    origin: string
    pattern: string
    enabled: boolean
    permitted: boolean
    mode: OriginMode | null
  }>
}

export type EnabledOriginEntry = {
  pattern: string
  origin: string
  mode: OriginMode
}
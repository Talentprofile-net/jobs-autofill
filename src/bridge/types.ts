import type { AtsName, OriginMode, ProfileValue } from '~/field/types'
import type { Profile, ProfileNote, TalentAnswer } from '~/api/types'

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

export type FieldResolveResult = {
  requestId: string
  value: ProfileValue
  profileField: string | null
}

export type LearnedAnswerFieldRequest = {
  requestId: string
  fieldName: string
  fieldType: string
  section: string
}

export type LearnedAnswerBridgeResult = {
  requestId: string
  value: ProfileValue
  matchedAnswerId: string | null
}

export type FillCounts = {
  filled: number
  skipped: number
  failed: number
  unsupported: number
}

export type FillBatchErrorKind =
  | 'not-authenticated'
  | 'network'
  | 'profile-fetch'
  | 'no-frames'
  | 'busy'
  | 'aborted'
  | 'unknown'

export type FillBatchError = {
  kind: FillBatchErrorKind
  message: string
}

export type FillBatchResult = {
  counts: FillCounts
  framesTimedOut: number
  framesUnresponsive: number
  total: number
  passes: number
  error?: FillBatchError
}

export type FillProgress = {
  counts: FillCounts
  total: number
  pass: number
}

export type FillPortIncoming =
  | { kind: 'fill.start'; tabId: number }

export type FillPortOutgoing =
  | { kind: 'fill.frame.started'; total: number; pass: number }
  | { kind: 'fill.progress'; counts: FillCounts; total: number; pass: number }
  | { kind: 'fill.done'; result: FillBatchResult }
  | { kind: 'fill.error'; error: FillBatchError }

export type ResolvedOriginMode = 'application' | 'notesOnly'

export type ResolverOutcomeKind = 'filled' | 'skipped' | 'unsupported' | 'failed'

// `fieldType` and `answerKind` are the CORPUS vocabulary, not the adapter's —
// mapped in capture/corpusVocabulary.ts before a record is built, so a captured
// answer and the scraped corpus row describing the same question agree.
export type AnswerCaptureRecord = {
  questionText: string
  normalizedQuestion: string
  fieldType: string
  section: string
  answerKind: string
  answerValue: ProfileValue
  answerText: string | null
  labelEnumId: string | null
  profileField: string | null
  resolverOutcome: ResolverOutcomeKind
  source: 'manual' | 'correction' | 'resolver_filled' | 'resolver_skipped'
  sourceAnswerId: string | null
}

// The capture handoff is two steps because a submit can destroy the page.
// `stage` runs at submit time and hands the batch to the background worker;
// `commit` or `discard` runs after detection, if the page is still alive to run
// it. An orphaned stage is resolved by the background worker, not here.
export type CaptureStagePayload = {
  applicationUrl: string
  ats: AtsName
  records: AnswerCaptureRecord[]
}

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
  | {
      id: string
      kind: 'resolveLearnedAnswers'
      fields: LearnedAnswerFieldRequest[]
    }
  | { id: string; kind: 'learnedAnswer.delete'; answerId: string }
  | { id: string; kind: 'mainWorld.ready' }
  | { id: string; kind: 'tab.fillAllResult'; batchId: string; counts: FillCounts; passes: number }
  | { id: string; kind: 'tab.fillStarted'; batchId: string; total: number; pass: number }
  | {
      id: string
      kind: 'tab.fillProgress'
      batchId: string
      delta: { filled: number; skipped: number; failed: number; unsupported: number }
      totalDelta: number
      pass: number
    }
  | { id: string; kind: 'tab.fillTotalIncreased'; batchId: string; addedTotal: number; pass: number }
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
  | {
      id: string
      kind: 'answers.stage'
      payload: CaptureStagePayload
    }
  | { id: string; kind: 'answers.commit'; stageId: string }
  | {
      id: string
      kind: 'answers.discard'
      stageId: string
      outcome: 'failure' | 'unknown'
    }

export type ContentScriptRequest =
  | {
      id: string
      kind: 'fieldValueResult'
      value: ProfileValue
      profileField: string | null
      error?: string
    }
  | {
      id: string
      kind: 'fieldValuesResult'
      values: FieldResolveResult[]
      error?: string
    }
  | {
      id: string
      kind: 'learnedAnswersResult'
      results: LearnedAnswerBridgeResult[]
      error?: string
    }
  | {
      id: string
      kind: 'learnedAnswer.deleteResult'
      answerId: string | null
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
  | { id: string; kind: 'mode.resolveAuto' }
  | { id: string; kind: 'cmd.openPicker' }
  | { id: string; kind: 'cmd.fillAllHotkey' }
  | {
      id: string
      kind: 'answers.stageResult'
      ok: boolean
      stageId?: string
      error?: string
    }
  | { id: string; kind: 'answers.commitResult'; ok: boolean; error?: string }
  | { id: string; kind: 'answers.discardResult'; ok: boolean }

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

export type LearnedAnswerSummary = {
  id: string
  questionText: string
  answerText: string | null
  fieldType: string
  lastUsedAt: string | null
  updatedAt: string
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
  | { kind: 'learnedAnswers.list' }
  | { kind: 'learnedAnswers.delete'; answerId: string }

export type ContentToBackground =
  | { kind: 'resolve'; fieldName: string; fieldType: string; section: string }
  | {
      kind: 'resolveMany'
      fields: (FieldResolveRequest & { requestId: string })[]
    }
  | {
      kind: 'learnedAnswers.resolve'
      fields: LearnedAnswerFieldRequest[]
    }
  | { kind: 'learnedAnswers.delete'; answerId: string }
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
  | { kind: 'mode.frameResolved'; mode: ResolvedOriginMode }
  | { kind: 'frame.register'; ats: AtsName; url: string }
  | { kind: 'frame.fillResult'; batchId: string; counts: FillCounts; passes: number }
  | { kind: 'frame.fillStarted'; batchId: string; total: number; pass: number }
  | {
      kind: 'frame.fillProgress'
      batchId: string
      delta: { filled: number; skipped: number; failed: number; unsupported: number }
      totalDelta: number
      pass: number
    }
  | { kind: 'frame.fillTotalIncreased'; batchId: string; addedTotal: number; pass: number }
  | { kind: 'answers.stage'; payload: CaptureStagePayload }
  | { kind: 'answers.commit'; stageId: string }
  | {
      kind: 'answers.discard'
      stageId: string
      outcome: 'failure' | 'unknown'
    }

export type ExternalToBackground =
  | {
      kind: 'auth.handoff'
      token: string
      refreshToken: string
      method: AuthMethod
    }
  | { kind: 'auth.ping' }
  | {
      destinationUrl: string
      kind: 'application.handoff'
      talentJobApplicationId: string
    }

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

export type { TalentAnswer }

import type { AtsName, OriginMode, PickerMode, ProfileValue } from '~/field/types'
import type { TalentAnswer } from '~/api/types'
import type { PickerRelay } from '~/ui/picker/protocol'

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
  jobCountry: string | null
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

export type FieldDescriptor = {
  fieldUuid: string
  fieldName: string
  fieldType: string
  section: string
  pickerMode: PickerMode
}

export type FillValueResult = {
  requestId: string
  value: ProfileValue
  profileField: string | null
  matchedAnswerId: string | null
}

export type FillProgressDelta = {
  filled: number
  skipped: number
  failed: number
  unsupported: number
}

export type FillDenialReason = 'dismissed' | 'signin' | 'untrusted' | 'unavailable'

export type MainWorldRequest =
  | { id: string; kind: 'mainWorld.ready' }
  | { id: string; kind: 'mode.get' }
  | {
      id: string
      kind: 'fill.fields'
      batchId: string
      fields: (FieldResolveRequest & { requestId: string })[]
    }
  | { id: string; kind: 'fill.started'; batchId: string; total: number; pass: number }
  | {
      id: string
      kind: 'fill.progress'
      batchId: string
      delta: FillProgressDelta
      totalDelta: number
      pass: number
    }
  | { id: string; kind: 'fill.totalIncreased'; batchId: string; addedTotal: number; pass: number }
  | { id: string; kind: 'fill.result'; batchId: string; counts: FillCounts; passes: number }
  | { id: string; kind: 'fill.request' }
  | { id: string; kind: 'widget.openDashboard' }
  | { id: string; kind: 'field.descriptor'; descriptor: FieldDescriptor | null }
  | { id: string; kind: 'capture.submit'; records: AnswerCaptureRecord[] }
  | { id: string; kind: 'capture.draft'; records: AnswerCaptureRecord[] }

export type ContentScriptRequest =
  | { id: string; kind: 'mainWorld.ping' }
  | { id: string; kind: 'mode.result'; mode: ResolvedOriginMode }
  | { id: string; kind: 'mode.changed'; mode: ResolvedOriginMode }
  | {
      id: string
      kind: 'fill.run'
      batchId: string
      emit: boolean
      requestId: string | null
      lowScore: boolean
    }
  | { id: string; kind: 'fill.values'; batchId: string; results: FillValueResult[] }
  | { id: string; kind: 'fill.denied'; requestId: string; reason: FillDenialReason }
  | { id: string; kind: 'field.describe'; fieldUuid: string }
  | { id: string; kind: 'field.fill'; fieldUuid: string; value: ProfileValue }

export type DetectedAts = AtsName | null

export type ProfileSummary = {
  profileName: string | null
  email: string | null
  jobTitle: string | null
  currentCompany: string | null
  location: string | null
  totalExperience: string | null
  openToWork: boolean
  topSkills: string[]
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
  | { kind: 'origin.intent.begin'; pattern: string; mode: OriginMode; tabId: number }
  | { kind: 'origin.intent.cancel'; pattern: string }
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
  | { kind: 'classifier.suggest'; request: unknown }
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
  | { kind: 'answers.saveDraft'; payload: CaptureStagePayload }
  | {
      kind: 'answers.discard'
      stageId: string
      outcome: 'failure' | 'unknown'
    }
  | PickerRelay

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
      jobCountry?: string | null
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

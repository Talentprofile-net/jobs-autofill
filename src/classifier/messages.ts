import type { AnswerKind, ClassifierInput, Decision } from '~/classifier/contract'

// A named port, not runtime.sendMessage: a broadcast message is delivered to
// every extension context, and the background router answers unknown kinds
// first, so the offscreen document's reply never wins the race. onConnect is
// filtered by name in every context, so only the classifier answers this one.
export const CLASSIFIER_PORT = 'classifier'

export type ClassifierRequestBody =
  | { kind: 'classify'; requests: { input: ClassifierInput; answerKind: AnswerKind }[] }
  | { kind: 'status' }

export type ClassifierRequest = ClassifierRequestBody & { id: number }

export type ClassifierResponse =
  | { id: number; ok: true; kind: 'classify'; decisions: Decision[]; runtimeId: string }
  | {
      id: number
      ok: true
      kind: 'status'
      modelVersion: string
      runtimeId: string
      labels: number
      loadMs: number
    }
  | { id: number; ok: false; error: string }

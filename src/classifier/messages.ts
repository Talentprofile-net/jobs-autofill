import type { AnswerKind, ClassifierInput, Decision } from '~/classifier/contract'

export const CLASSIFY_MESSAGE = 'classifier.classify'
export const STATUS_MESSAGE = 'classifier.status'

export type ClassifyMessage = {
  kind: typeof CLASSIFY_MESSAGE
  requests: { input: ClassifierInput; answerKind: AnswerKind }[]
}

export type StatusMessage = {
  kind: typeof STATUS_MESSAGE
}

export type ClassifierMessage = ClassifyMessage | StatusMessage

export type ClassifyResponse =
  | { ok: true; decisions: Decision[] }
  | { ok: false; error: string }

export type StatusResponse =
  | { ok: true; modelVersion: string; labels: number; loadMs: number }
  | { ok: false; error: string }

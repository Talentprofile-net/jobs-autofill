import type { PageJob } from '~/capture/pageJob'

export const COVER_LETTER_DRAFT_PATH = '/api/v1/cover-letter/draft'

const MAX_QUESTION_LENGTH = 300

export type CoverLetterDraftRequest = {
  applicationId?: string
  job?: PageJob
  question?: string
}

export type CoverLetterDraft = { draft: string; issues: string[] }

export type DraftFailure = 'rate_limited' | 'draft_failed'

export type DraftSource = { applicationId: string | null; job: PageJob | null }

const withQuestion = (request: CoverLetterDraftRequest, question: string): CoverLetterDraftRequest => {
  const trimmed = question.trim().slice(0, MAX_QUESTION_LENGTH)
  return trimmed ? { ...request, question: trimmed } : request
}

export const coverLetterDraftRequest = (source: DraftSource, question: string): CoverLetterDraftRequest | null => {
  if (source.applicationId) return withQuestion({ applicationId: source.applicationId }, question)
  if (source.job) return withQuestion({ job: source.job }, question)
  return null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const readCoverLetterDraft = (value: unknown): CoverLetterDraft | null => {
  if (!isRecord(value) || typeof value.draft !== 'string' || value.draft.trim() === '') return null
  const issues = Array.isArray(value.issues)
    ? value.issues.filter((issue): issue is string => typeof issue === 'string' && issue.trim() !== '')
    : []
  return { draft: value.draft, issues }
}

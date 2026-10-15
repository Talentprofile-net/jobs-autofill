import { apiFetch, ApiError } from './client'
import { COVER_LETTER_DRAFT_PATH, readCoverLetterDraft, type CoverLetterDraft, type CoverLetterDraftRequest, type DraftFailure } from './coverLetter'

const DRAFT_TIMEOUT_MS = 60_000

export const draftFailure = (error: unknown): DraftFailure =>
  error instanceof ApiError && error.status === 429 ? 'rate_limited' : 'draft_failed'

export const requestCoverLetterDraft = async (request: CoverLetterDraftRequest): Promise<CoverLetterDraft> => {
  const draft = readCoverLetterDraft(
    await apiFetch<unknown>(COVER_LETTER_DRAFT_PATH, {
      body: JSON.stringify(request),
      method: 'POST',
      timeoutMs: DRAFT_TIMEOUT_MS,
    }),
  )
  if (!draft) throw new Error('draft_failed')
  return draft
}

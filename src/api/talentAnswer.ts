import { apiFetch, ApiError } from './client'
import type { AnswerCaptureRecord } from '~/bridge/types'
import type { TalentAnswer } from './types'

export type CaptureBatchInput = {
  ats: string | null
  originalJobPostUrl: string
  pageUrl: string | null
  records: AnswerCaptureRecord[]
  talentJobApplicationId: string | null
}

export type CaptureBatchResult = {
  applicationId: string
  saved: number
}

// One request for a whole form, because the client cannot make several correct.
//
// Per-answer writes fail independently, so a flush that lost its network halfway
// stored some answers and lost the rest — and the buffered originals are gone
// with the page. The old shape also had to guess what a 409 meant: the backend
// answers 409 for both a duplicate row and a transaction conflict, and its error
// envelope carries no Prisma code, so "already saved, update it" and "retry me"
// were indistinguishable from here.
//
// The backend resolves the application, upserts every answer, and retries
// serialization conflicts inside ONE serializable transaction. It answers only
// after that commits, so a 2xx means the entire batch is durable and anything
// else means none of it is.
export const captureAnswerBatch = async (
  input: CaptureBatchInput,
): Promise<CaptureBatchResult> => {
  const result = await apiFetch<CaptureBatchResult>('/api/v1/talentanswer', {
    method: 'POST',
    headers: { 'x-api-variant': 'extension.capture-batch' },
    body: JSON.stringify({
      ats: input.ats,
      originalJobPostUrl: input.originalJobPostUrl,
      pageUrl: input.pageUrl,
      records: input.records,
      talentJobApplicationId: input.talentJobApplicationId,
    }),
  })
  if (!result) {
    throw new ApiError(0, 'Capture batch returned no body')
  }
  return result
}

const ANSWER_PAGE_SIZE = 200

// KEYSET on IMMUTABLE columns, no row cap.
//
// Offset paging cannot read a whole history safely: any row inserted or moved
// between two pages shifts every row after it, so one slides across the boundary
// and is never read. A skipped answer reads to the user as "you never answered
// this" — silent, and indistinguishable from having no history.
//
// A cursor on `updatedAt` only narrows that window, because `updatedAt` MUTATES.
// A capture batch that touches an old answer moves it to the front of a
// descending scan while the scan is still running, so a row the reader has not
// reached yet jumps behind the cursor and is skipped — the same loss, now caused
// by the user's own activity rather than by paging.
//
// `createdAt` is written once and `id` never changes, so (createdAt, id) is a
// total order stable for the whole read. Rows updated mid-scan keep their place;
// only genuinely new rows appear, and they sort ahead of the cursor where the
// next hydration finds them.
//
// There is no page cap either. A cap is a silent truncation dressed as a limit —
// it drops the OLDEST answers, exactly the ones a long-lived user can no longer
// re-derive. The loop ends on a short page, and its only other exit is the cursor
// failing to advance, which is a bug and says so.
export type AnswerCursor = { createdAt: string; id: string }

export const answerCursorWhere = (cursor: AnswerCursor) => ({
  OR: [
    { createdAt: { lt: cursor.createdAt } },
    { createdAt: { equals: cursor.createdAt }, id: { lt: cursor.id } },
  ],
})

export const ANSWER_HYDRATION_ORDER = [
  { createdAt: 'desc' },
  { id: 'desc' },
] as const

// Answers are NOT part of the profile projection and must not be: that shape is
// the broad hydration read, and the answer store is a per-application history
// that grows without bound. The talentAnswer route is already scoped to the
// caller's own profile by a forced value, so reading it directly is both the
// narrower and the owner-safe option.
export const fetchMyTalentAnswers = async (): Promise<TalentAnswer[]> => {
  const all: TalentAnswer[] = []
  let cursor: AnswerCursor | null = null

  for (;;) {
    const query = new URLSearchParams({
      orderBy: JSON.stringify(ANSWER_HYDRATION_ORDER),
      take: String(ANSWER_PAGE_SIZE),
    })
    if (cursor) query.set('where', JSON.stringify(answerCursorWhere(cursor)))

    const rows = await apiFetch<TalentAnswer[]>(
      `/api/v1/talentanswer?${query.toString()}`,
      { method: 'GET' },
    )
    if (!rows || rows.length === 0) return all

    all.push(...rows)

    // Page by what came back, never by what was asked for: the route clamps
    // `take` to its own maximum, so a short page is the only reliable end signal.
    if (rows.length < ANSWER_PAGE_SIZE) return all

    const last = rows[rows.length - 1]
    if (cursor && last.id === cursor.id) {
      // The cursor did not move, so the next request would repeat this page for
      // ever. Something is wrong with the ordering contract; stop and say so
      // rather than spin.
      console.warn(
        `[TP] Learned-answer cursor stalled at ${all.length} rows; history may be incomplete`,
      )
      return all
    }
    cursor = { createdAt: last.createdAt, id: last.id }
  }
}

export const touchTalentAnswer = async (id: string): Promise<void> => {
  await apiFetch('/api/v1/talentanswer', {
    method: 'PUT',
    body: JSON.stringify({
      where: { id },
      data: { lastUsedAt: new Date().toISOString() },
    }),
  })
}

export const deleteTalentAnswer = async (id: string): Promise<void> => {
  await apiFetch('/api/v1/talentanswer', {
    method: 'DELETE',
    body: JSON.stringify({ where: { id } }),
  })
}

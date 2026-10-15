import { readCoverLetterDraft, type CoverLetterDraft, type DraftFailure } from '~/api/coverLetter'
import type { BackgroundResponse } from '~/bridge/types'
import { isCoverLetterQuestion } from '~/resolver/coverLetter'
import type { InsertResult } from './insertion'

const DRAFT_FIELD_TYPES: ReadonlySet<string> = new Set(['ContentEditable', 'TextArea', 'TextInput'])

export const isCoverLetterDraftField = (descriptor: { fieldName: string; fieldType: string; pickerMode: string }): boolean =>
  descriptor.pickerMode === 'full' &&
  DRAFT_FIELD_TYPES.has(descriptor.fieldType) &&
  isCoverLetterQuestion(descriptor.fieldName)

export type DraftResult = { ok: true; draft: CoverLetterDraft } | { ok: false; failure: DraftFailure }

export type DraftState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; draft: string; issues: string[] }
  | { status: 'failed'; message: string }

const FAILURE_MESSAGES: Record<DraftFailure, string> = {
  draft_failed: "Couldn't draft a letter. Try again or write your own.",
  rate_limited: 'Draft limit reached. Try again later.',
}

export const draftFailureMessage = (failure: DraftFailure): string => FAILURE_MESSAGES[failure]

const FAILED: DraftResult = { failure: 'draft_failed', ok: false }

export const readDraftResult = (response: BackgroundResponse<unknown>): DraftResult => {
  if (!response.ok) return { failure: response.error === 'rate_limited' ? 'rate_limited' : 'draft_failed', ok: false }
  const draft = readCoverLetterDraft(response.data)
  return draft ? { draft, ok: true } : FAILED
}

export const createDraftFlow = (dependencies: {
  draft: (question: string) => Promise<DraftResult>
  insert: (text: string) => Promise<InsertResult>
  show: (state: DraftState) => void
}) => {
  let ticket = 0
  let state: DraftState = { status: 'idle' }
  const set = (next: DraftState): void => {
    state = next
    dependencies.show(next)
  }
  return {
    cancel: (): void => {
      ticket += 1
      set({ status: 'idle' })
    },
    close: (): void => {
      ticket += 1
    },
    insert: async (text: string): Promise<InsertResult | null> => {
      if (state.status !== 'ready' || text.trim() === '') return null
      ticket += 1
      set({ status: 'idle' })
      return dependencies.insert(text)
    },
    start: async (question: string): Promise<void> => {
      if (state.status === 'loading') return
      const current = ++ticket
      set({ status: 'loading' })
      const result = await dependencies.draft(question).catch(() => FAILED)
      if (current !== ticket) return
      set(
        result.ok
          ? { draft: result.draft.draft, issues: result.draft.issues, status: 'ready' }
          : { message: draftFailureMessage(result.failure), status: 'failed' },
      )
    },
  }
}

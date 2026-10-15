import { describe, expect, it, mock } from 'bun:test'

class FakeApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

type Call = { path: string; init: RequestInit & { timeoutMs?: number } }

const calls: Call[] = []
let reply: () => unknown = () => ({ draft: 'Dear team', issues: [] })

mock.module('./client', () => ({
  ApiError: FakeApiError,
  apiFetch: async (path: string, init: Call['init']) => {
    calls.push({ init, path })
    return reply()
  },
}))

const { COVER_LETTER_DRAFT_PATH } = await import('./coverLetter')
const { draftFailure, requestCoverLetterDraft } = await import('./coverLetterDraft')

const job = { company: 'Acme', description: 'Build things', title: 'Engineer', url: 'https://jobs.example.test/1' }

describe('cover-letter draft call', () => {
  it('maps 429 to the rate limit and every other failure to draft_failed', () => {
    expect(draftFailure(new FakeApiError(429, 'Too many requests'))).toBe('rate_limited')
    for (const status of [400, 404, 422, 503]) {
      expect(draftFailure(new FakeApiError(status, 'draft_failed'))).toBe('draft_failed')
    }
    expect(draftFailure(new Error('offline'))).toBe('draft_failed')
  })

  it('posts the request to the draft endpoint', async () => {
    calls.length = 0
    reply = () => ({ draft: 'Dear team', issues: ['Check the company name'] })
    const draft = await requestCoverLetterDraft({ applicationId: 'app-1', question: 'Cover letter' })
    expect(draft).toEqual({ draft: 'Dear team', issues: ['Check the company name'] })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.path).toBe(COVER_LETTER_DRAFT_PATH)
    expect(calls[0]?.init.method).toBe('POST')
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ applicationId: 'app-1', question: 'Cover letter' })
  })

  it('rejects a success response without a draft', async () => {
    reply = () => ({ issues: [] })
    const error = await requestCoverLetterDraft({ job }).then(
      () => null,
      (e: unknown) => e,
    )
    expect(error instanceof Error ? error.message : error).toBe('draft_failed')
  })
})

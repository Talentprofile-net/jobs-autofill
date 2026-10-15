import { describe, expect, it } from 'bun:test'

import { coverLetterDraftRequest, readCoverLetterDraft } from './coverLetter'

const job = { company: 'Acme', description: 'Build things', title: 'Engineer', url: 'https://jobs.example.test/1' }

describe('cover-letter draft request', () => {
  it('prefers the bound application over the page job', () => {
    expect(coverLetterDraftRequest({ applicationId: 'app-1', job }, 'Cover letter')).toEqual({ applicationId: 'app-1', question: 'Cover letter' })
  })

  it('sends the page job when no application is bound', () => {
    expect(coverLetterDraftRequest({ applicationId: null, job }, '  Cover letter  ')).toEqual({ job, question: 'Cover letter' })
  })

  it('offers no draft without an application or a page job', () => {
    expect(coverLetterDraftRequest({ applicationId: null, job: null }, 'Cover letter')).toBeNull()
    expect(coverLetterDraftRequest({ applicationId: '', job: null }, 'Cover letter')).toBeNull()
  })

  it('omits an empty question and caps a long one', () => {
    expect(coverLetterDraftRequest({ applicationId: 'app-1', job: null }, '   ')).toEqual({ applicationId: 'app-1' })
    expect(coverLetterDraftRequest({ applicationId: 'app-1', job: null }, 'q'.repeat(5000))?.question).toHaveLength(300)
  })
})

describe('cover-letter draft response', () => {
  it('reads the draft and keeps only text issues', () => {
    expect(readCoverLetterDraft({ draft: 'Dear team', issues: ['Too long', 3, ' ', 'No company'] })).toEqual({ draft: 'Dear team', issues: ['Too long', 'No company'] })
    expect(readCoverLetterDraft({ draft: 'Dear team' })).toEqual({ draft: 'Dear team', issues: [] })
  })

  it('refuses an empty or malformed draft', () => {
    expect(readCoverLetterDraft({ draft: '  ', issues: [] })).toBeNull()
    expect(readCoverLetterDraft({ error: 'draft_failed' })).toBeNull()
    expect(readCoverLetterDraft(undefined)).toBeNull()
  })
})

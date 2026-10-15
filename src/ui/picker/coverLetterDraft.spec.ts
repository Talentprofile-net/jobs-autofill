import { describe, expect, it } from 'bun:test'

import {
  createDraftFlow,
  draftFailureMessage,
  isCoverLetterDraftField,
  readDraftResult,
  type DraftResult,
  type DraftState,
} from './coverLetterDraft'

const field = (fieldName: string, fieldType: string, pickerMode = 'full') => ({ fieldName, fieldType, pickerMode })

const deferred = () => {
  let resolve: (result: DraftResult) => void = () => {}
  const promise = new Promise<DraftResult>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const harness = () => {
  const replies: ReturnType<typeof deferred>[] = []
  const questions: string[] = []
  const inserted: string[] = []
  const states: DraftState[] = []
  const flow = createDraftFlow({
    draft: (question) => {
      questions.push(question)
      const reply = deferred()
      replies.push(reply)
      return reply.promise
    },
    insert: async (text) => {
      inserted.push(text)
      return { inserted: true, maxLength: null, truncated: false }
    },
    show: (state) => states.push(state),
  })
  return { flow, inserted, questions, replies, states }
}

const ready: DraftResult = { draft: { draft: 'Dear Acme team', issues: ['Name the hiring manager'] }, ok: true }

describe('cover-letter draft field', () => {
  it('offers drafting only for cover-letter text fields', () => {
    expect(isCoverLetterDraftField(field('Cover letter', 'TextArea'))).toBe(true)
    expect(isCoverLetterDraftField(field('Motivation letter', 'TextInput'))).toBe(true)
    expect(isCoverLetterDraftField(field('Letter of interest', 'ContentEditable'))).toBe(true)
    expect(isCoverLetterDraftField(field('Cover letter', 'FileUpload'))).toBe(false)
    expect(isCoverLetterDraftField(field('Cover letter', 'SingleFileUpload'))).toBe(false)
    expect(isCoverLetterDraftField(field('Cover letter', 'SimpleDropdown'))).toBe(false)
    expect(isCoverLetterDraftField(field('Why do you want to join?', 'TextArea'))).toBe(false)
    expect(isCoverLetterDraftField(field('Cover letter', 'TextArea', 'notesOnly'))).toBe(false)
  })
})

describe('cover-letter draft flow', () => {
  it('loads a draft for the field question and shows it with its issues', async () => {
    const { flow, questions, replies, states } = harness()
    const loading = flow.start('Cover letter')
    expect(states).toEqual([{ status: 'loading' }])
    replies[0]?.resolve(ready)
    await loading
    expect(questions).toEqual(['Cover letter'])
    expect(states.at(-1)).toEqual({ draft: 'Dear Acme team', issues: ['Name the hiring manager'], status: 'ready' })
  })

  it('inserts the edited text once, only after Insert', async () => {
    const { flow, inserted, replies, states } = harness()
    const loading = flow.start('Cover letter')
    replies[0]?.resolve(ready)
    await loading
    expect(inserted).toEqual([])
    expect(await flow.insert('Dear Acme team, edited')).toEqual({ inserted: true, maxLength: null, truncated: false })
    expect(await flow.insert('Dear Acme team, edited')).toBeNull()
    expect(inserted).toEqual(['Dear Acme team, edited'])
    expect(states.at(-1)).toEqual({ status: 'idle' })
  })

  it('inserts nothing on Cancel and drops a draft that arrives afterwards', async () => {
    const { flow, inserted, replies, states } = harness()
    const loading = flow.start('Cover letter')
    flow.cancel()
    replies[0]?.resolve(ready)
    await loading
    expect(await flow.insert('Dear Acme team')).toBeNull()
    expect(inserted).toEqual([])
    expect(states).toEqual([{ status: 'loading' }, { status: 'idle' }])
  })

  it('inserts nothing before a draft is ready or when the text is empty', async () => {
    const { flow, inserted, replies } = harness()
    expect(await flow.insert('Dear Acme team')).toBeNull()
    const loading = flow.start('Cover letter')
    expect(await flow.insert('Dear Acme team')).toBeNull()
    replies[0]?.resolve(ready)
    await loading
    expect(await flow.insert('   ')).toBeNull()
    expect(inserted).toEqual([])
  })

  it('drops a draft that arrives after the picker closed', async () => {
    const { flow, replies, states } = harness()
    const loading = flow.start('Cover letter')
    flow.close()
    replies[0]?.resolve(ready)
    await loading
    expect(states).toEqual([{ status: 'loading' }])
  })

  it('ignores a second request while one is loading', async () => {
    const { flow, questions } = harness()
    void flow.start('Cover letter')
    void flow.start('Cover letter')
    expect(questions).toHaveLength(1)
  })

  it('shows a short message for a failed or rate-limited draft and can retry', async () => {
    const { flow, replies, states } = harness()
    const failing = flow.start('Cover letter')
    replies[0]?.resolve({ failure: 'rate_limited', ok: false })
    await failing
    expect(states.at(-1)).toEqual({ message: 'Draft limit reached. Try again later.', status: 'failed' })
    const retry = flow.start('Cover letter')
    replies[1]?.resolve({ failure: 'draft_failed', ok: false })
    await retry
    expect(states.at(-1)).toEqual({ message: "Couldn't draft a letter. Try again or write your own.", status: 'failed' })
  })

  it('treats a rejected request as a failed draft', async () => {
    const states: DraftState[] = []
    const flow = createDraftFlow({
      draft: () => Promise.reject(new Error('worker stopped')),
      insert: async () => ({ inserted: true, maxLength: null, truncated: false }),
      show: (state) => states.push(state),
    })
    await flow.start('Cover letter')
    expect(states.at(-1)).toEqual({ message: draftFailureMessage('draft_failed'), status: 'failed' })
  })
})

describe('draft response from the background', () => {
  it('maps error codes to failures', () => {
    expect(readDraftResult({ error: 'rate_limited', ok: false })).toEqual({ failure: 'rate_limited', ok: false })
    expect(readDraftResult({ error: 'draft_failed', ok: false })).toEqual({ failure: 'draft_failed', ok: false })
    expect(readDraftResult({ error: 'Could not establish connection', ok: false })).toEqual({ failure: 'draft_failed', ok: false })
  })

  it('reads a draft and refuses a malformed one', () => {
    expect(readDraftResult({ data: { draft: 'Dear team', issues: [] }, ok: true })).toEqual({ draft: { draft: 'Dear team', issues: [] }, ok: true })
    expect(readDraftResult({ data: { draft: '' }, ok: true })).toEqual({ failure: 'draft_failed', ok: false })
    expect(readDraftResult({ ok: true })).toEqual({ failure: 'draft_failed', ok: false })
  })
})

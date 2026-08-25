import { afterEach, describe, expect, it, mock } from 'bun:test'

import type { TalentAnswer } from './types'

// Hydration reads the caller's WHOLE answer history, and every failure mode here
// is silent: a skipped row is indistinguishable from a question the user never
// answered, so the fill quietly stops offering something it was taught.
//
// The cursor is therefore on immutable columns. A cursor on `updatedAt` looked
// correct and lost rows to the user's own concurrent captures — the case
// `skips nothing when an unread row is updated mid-read` reproduces exactly that.

type Row = Pick<TalentAnswer, 'createdAt' | 'id'> & Partial<TalentAnswer>

// Stubbed at the client boundary, not at `fetch`. `apiFetch` owns token refresh
// and reads `browser.storage.local`, none of which is what paging is about —
// standing that up would test the auth layer and hide the query under it. What
// this replaces is one function whose contract is "given a path, give me rows",
// which leaves the URL `fetchMyTalentAnswers` builds fully under test.
let handler: (path: string) => unknown = () => []

mock.module('./client', () => ({
  ApiError: class ApiError extends Error {},
  apiFetch: async (path: string) => handler(path),
}))

const { ANSWER_HYDRATION_ORDER, answerCursorWhere, fetchMyTalentAnswers } =
  await import('./talentAnswer')

// A server that really sorts and really applies the cursor, so paging is
// exercised against the ordering contract rather than against a canned list.
const serve = (rows: Row[], pageSize: number) => {
  const requests: { take: number; where: null | string }[] = []

  handler = (path: string) => {
    const query = new URL(path, 'https://example.test').searchParams
    const where = query.get('where')
    const take = Number(query.get('take'))
    requests.push({ take, where })

    const ordered = [...rows].sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1
      return a.id < b.id ? 1 : -1
    })

    const after = where
      ? (() => {
          const parsed = JSON.parse(where) as {
            OR: [
              { createdAt: { lt: string } },
              { createdAt: { equals: string }; id: { lt: string } },
            ]
          }
          const createdAt = parsed.OR[0].createdAt.lt
          const id = parsed.OR[1].id.lt
          return ordered.filter(
            (row) =>
              row.createdAt < createdAt ||
              (row.createdAt === createdAt && row.id < id),
          )
        })()
      : ordered

    return after.slice(0, Math.min(take, pageSize))
  }

  return { requests }
}

const row = (id: string, createdAt: string): Row => ({ createdAt, id })

// Generated newest-first so the ids and the sort order are easy to read back.
const manyRows = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) =>
    row(
      `answer-${String(count - i).padStart(4, '0')}`,
      new Date(Date.UTC(2026, 0, 1) + (count - i) * 60_000).toISOString(),
    ),
  )

afterEach(() => {
  handler = () => []
})

describe('hydration — the cursor shape', () => {
  it('orders on immutable columns only', () => {
    expect(ANSWER_HYDRATION_ORDER).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ])
  })

  it('asks for rows strictly after the last one seen', () => {
    expect(
      answerCursorWhere({ createdAt: '2026-01-01T00:00:00.000Z', id: 'a5' }),
    ).toEqual({
      OR: [
        { createdAt: { lt: '2026-01-01T00:00:00.000Z' } },
        { createdAt: { equals: '2026-01-01T00:00:00.000Z' }, id: { lt: 'a5' } },
      ],
    })
  })
})

describe('hydration — paging', () => {
  it('returns a single short page without asking for a second', async () => {
    const { requests } = serve(manyRows(5), 200)

    const all = await fetchMyTalentAnswers()

    expect(all).toHaveLength(5)
    expect(requests).toHaveLength(1)
    expect(requests[0].where).toBeNull()
  })

  it('reads every row across several full pages', async () => {
    const rows = manyRows(450)
    serve(rows, 200)

    const all = await fetchMyTalentAnswers()

    expect(all).toHaveLength(450)
    expect(new Set(all.map((a) => a.id)).size, 'no row read twice').toBe(450)
  })

  it('carries a cursor on every page after the first', async () => {
    const { requests } = serve(manyRows(450), 200)

    await fetchMyTalentAnswers()

    expect(requests).toHaveLength(3)
    expect(requests[0].where).toBeNull()
    expect(requests[1].where).toContain('createdAt')
    expect(requests[2].where).toContain('createdAt')
  })

  it('reads rows that share a createdAt, breaking the tie on id', async () => {
    const sameInstant = '2026-01-01T00:00:00.000Z'
    const rows = Array.from({ length: 250 }, (_, i) =>
      row(`answer-${String(i).padStart(4, '0')}`, sameInstant),
    )
    serve(rows, 200)

    const all = await fetchMyTalentAnswers()

    expect(all).toHaveLength(250)
    expect(new Set(all.map((a) => a.id)).size).toBe(250)
  })

  it('stops rather than spinning when the cursor cannot advance', async () => {
    // A server that ignores the cursor: every page comes back identical and full.
    // Without the stall guard this loops for ever.
    const page = manyRows(200)
    handler = () => page

    const all = await fetchMyTalentAnswers()

    expect(all).toHaveLength(400)
  })

  it('returns what it has when a page comes back empty', async () => {
    let call = 0
    handler = () => {
      call += 1
      return call === 1 ? manyRows(200) : []
    }

    const all = await fetchMyTalentAnswers()

    expect(all).toHaveLength(200)
  })
})

describe('hydration — rows moved by concurrent writes', () => {
  // THE regression. Under a cursor on `updatedAt`, a capture batch touching an
  // OLD answer bumps it to the front of the descending scan; the reader has
  // already passed that position, so the row is never returned. On (createdAt,
  // id) the row cannot move at all.
  it('skips nothing when an unread row is updated mid-read', async () => {
    const rows = manyRows(400)
    const { requests } = serve(rows, 200)

    const realHandler = handler
    let pages = 0
    handler = (path: string) => {
      const response = realHandler(path)
      pages += 1
      if (pages === 1) {
        // Simulate the user answering a form between pages: an old, still-unread
        // row is written to. Only `updatedAt` changes; `createdAt` and `id` are
        // immutable, so its position in this read cannot shift.
        const victim = rows[rows.length - 1]
        victim.updatedAt = new Date().toISOString()
      }
      return response
    }

    const all = await fetchMyTalentAnswers()

    expect(all).toHaveLength(400)
    expect(
      all.map((a) => a.id),
      'the row touched mid-read is still present',
    ).toContain(rows[rows.length - 1].id)
    expect(requests.length).toBeGreaterThan(1)
  })

  it('does not re-read a row that was already returned', async () => {
    const rows = manyRows(400)
    serve(rows, 200)

    const all = await fetchMyTalentAnswers()
    const ids = all.map((a) => a.id)

    expect(new Set(ids).size).toBe(ids.length)
  })
})

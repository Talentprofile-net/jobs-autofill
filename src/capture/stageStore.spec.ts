import { describe, expect, it } from 'bun:test'

import {
  createStageStore,
  drainPendingStages,
  recordRetryableStageFailure,
  stageAndSettle,
  STAGE_RETRY_LIMIT,
  STAGE_TTL_MS,
  type CaptureStage,
  type StageStorageArea,
} from './stageStore'

// The two properties a staged capture has to hold, executed rather than argued:
//
//   1. Two tabs staging at the same moment do not erase each other. The store
//      exists so a batch is never lost, so the store itself must not lose one.
//   2. A submit whose navigation beats the write to disk still commits. The
//      navigation listener runs before the stage exists, finds nothing, and
//      nothing else would ever pick that batch up.

// A storage area that INTERLEAVES: every operation yields to the event loop
// between reading and writing, which is exactly where a read-modify-write store
// loses an update. A store that passes against this cannot be doing one.
const makeArea = (): StageStorageArea & { raw: Map<string, unknown> } => {
  const raw = new Map<string, unknown>()
  const yieldTurn = () => new Promise((resolve) => setTimeout(resolve, 0))

  return {
    raw,
    get: async (keys) => {
      await yieldTurn()
      if (keys === null) return Object.fromEntries(raw.entries())
      return raw.has(keys) ? { [keys]: raw.get(keys) } : {}
    },
    remove: async (keys) => {
      await yieldTurn()
      for (const key of Array.isArray(keys) ? keys : [keys]) raw.delete(key)
    },
    set: async (items) => {
      await yieldTurn()
      for (const [key, value] of Object.entries(items)) raw.set(key, value)
    },
  }
}

const NOW = 1_800_000_000_000

const stage = (over: Partial<CaptureStage> = {}): CaptureStage => ({
  applicationUrl: 'https://acme.example/jobs/1',
  ats: 'greenhouse',
  attempts: 0,
  id: 'stage-1',
  lastError: null,
  records: [],
  talentJobApplicationId: null,
  stagedAt: NOW,
  tabId: 1,
  ...over,
})

const deps = (
  area: StageStorageArea,
  opts: { urls?: Record<number, null | string> } = {},
) => {
  const committed: CaptureStage[] = []
  return {
    committed,
    deps: {
      commit: async (s: CaptureStage) => {
        committed.push(s)
      },
      store: createStageStore(area),
      tabUrl: async (tabId: number) => opts.urls?.[tabId] ?? null,
    },
  }
}

describe('stage store — concurrent tabs', () => {
  it('keeps both stages when two tabs stage at the same moment', async () => {
    const area = makeArea()
    const store = createStageStore(area)

    await Promise.all([
      store.put(stage({ id: 'from-tab-1', tabId: 1 })),
      store.put(stage({ id: 'from-tab-2', tabId: 2 })),
    ])

    const ids = (await store.readAll()).map((s) => s.id).sort()
    expect(ids).toEqual(['from-tab-1', 'from-tab-2'])
  })

  it('keeps every stage when many tabs stage at once', async () => {
    const area = makeArea()
    const store = createStageStore(area)

    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        store.put(stage({ id: `stage-${i}`, tabId: i })),
      ),
    )

    expect((await store.readAll()).length).toBe(12)
  })

  it('drops only the named stage when one tab drops while another stages', async () => {
    const area = makeArea()
    const store = createStageStore(area)
    await store.put(stage({ id: 'existing', tabId: 1 }))

    await Promise.all([
      store.drop('existing'),
      store.put(stage({ id: 'incoming', tabId: 2 })),
    ])

    const ids = (await store.readAll()).map((s) => s.id)
    expect(ids).toEqual(['incoming'])
  })

  // The sweep must not be able to take a stage written while it was running.
  it('does not clobber a concurrent insert while pruning', async () => {
    const area = makeArea()
    const store = createStageStore(area)
    await store.put(stage({ id: 'ancient', stagedAt: NOW - STAGE_TTL_MS - 1 }))

    await Promise.all([
      store.pruneExpired(NOW),
      store.put(stage({ id: 'fresh', stagedAt: NOW })),
    ])

    const ids = (await store.readAll()).map((s) => s.id)
    expect(ids).toContain('fresh')
    expect(ids).not.toContain('ancient')
  })

  it('prunes a stage that has exhausted its retries', async () => {
    const area = makeArea()
    const store = createStageStore(area)
    await store.put(stage({ attempts: STAGE_RETRY_LIMIT, id: 'spent' }))
    await store.put(stage({ attempts: STAGE_RETRY_LIMIT - 1, id: 'trying' }))

    await store.pruneExpired(NOW)

    expect((await store.readAll()).map((s) => s.id)).toEqual(['trying'])
  })

  it('reads one stage back by id without seeing the others', async () => {
    const area = makeArea()
    const store = createStageStore(area)
    await store.put(stage({ id: 'a' }))
    await store.put(stage({ id: 'b' }))

    expect((await store.read('a'))?.id).toBe('a')
    expect(await store.read('missing')).toBeNull()
  })

  it('ignores unrelated keys living in the same storage area', async () => {
    const area = makeArea()
    area.raw.set('tp.profileCache', { data: {} })
    const store = createStageStore(area)
    await store.put(stage())

    expect((await store.readAll()).map((s) => s.id)).toEqual(['stage-1'])
    await store.pruneExpired(NOW + STAGE_TTL_MS + 1)
    expect(area.raw.has('tp.profileCache')).toBe(true)
  })
})

describe('stage store — navigation racing persistence', () => {
  // THE race. The tab is already on the confirmation page by the time the write
  // lands, so the navigation listener has already run and found nothing.
  it('commits when the tab already left before the write landed', async () => {
    const area = makeArea()
    const { committed, deps: d } = deps(area, {
      urls: { 1: 'https://acme.example/thank-you' },
    })

    const result = await stageAndSettle(d, stage())

    expect(result.committed).toBe(true)
    expect(committed.map((s) => s.id)).toEqual(['stage-1'])
  })

  it('leaves the stage to its own page when the tab has not moved', async () => {
    const area = makeArea()
    const { committed, deps: d } = deps(area, {
      urls: { 1: 'https://acme.example/jobs/1' },
    })

    const result = await stageAndSettle(d, stage())

    expect(result.committed).toBe(false)
    expect(committed).toEqual([])
  })

  // An unreadable url is not evidence of navigation. Committing on it would fire
  // on every stage in a tab whose url this extension cannot see.
  it('does not commit when the tab url cannot be read', async () => {
    const area = makeArea()
    const { committed, deps: d } = deps(area, { urls: { 1: null } })

    await stageAndSettle(d, stage())

    expect(committed).toEqual([])
  })

  it('does not commit a stage with no tab to ask about', async () => {
    const area = makeArea()
    const { committed, deps: d } = deps(area)

    await stageAndSettle(d, stage({ tabId: null }))

    expect(committed).toEqual([])
  })

  // Whatever the race did, the batch is on disk. Losing it is the one outcome
  // that has no recovery.
  it('persists the stage before deciding anything', async () => {
    const area = makeArea()
    const { deps: d } = deps(area, {
      urls: { 1: 'https://acme.example/jobs/1' },
    })

    await stageAndSettle(d, stage())

    expect((await d.store.read('stage-1'))?.id).toBe('stage-1')
  })
})

describe('stage store — draining what nothing else will finish', () => {
  it('retries on the same URL after authentication becomes available', async () => {
    const area = makeArea()
    const { committed, deps: d } = deps(area, {
      urls: { 1: 'https://acme.example/jobs/1' },
    })
    const unauthenticated = stage()
    await d.store.put(unauthenticated)
    await recordRetryableStageFailure(
      d.store,
      unauthenticated,
      'Not authenticated',
    )

    await drainPendingStages(d, NOW)

    expect(committed).toHaveLength(1)
    expect(committed[0]?.attempts).toBe(1)
    expect(committed[0]?.lastError).toBe('Not authenticated')
  })

  it('retries a stage that has already failed', async () => {
    const area = makeArea()
    const { committed, deps: d } = deps(area, {
      urls: { 1: 'https://acme.example/jobs/1' },
    })
    await d.store.put(stage({ attempts: 2, id: 'failed-once' }))

    await drainPendingStages(d, NOW)

    expect(committed.map((s) => s.id)).toEqual(['failed-once'])
  })

  // An untried stage belongs to its own page — unless that page is gone, which
  // is the orphan case the worker may have been suspended through.
  it('leaves an untried stage alone while its page is still there', async () => {
    const area = makeArea()
    const { committed, deps: d } = deps(area, {
      urls: { 1: 'https://acme.example/jobs/1' },
    })
    await d.store.put(stage({ attempts: 0 }))

    await drainPendingStages(d, NOW)

    expect(committed).toEqual([])
  })

  it('commits an untried stage whose page is gone', async () => {
    const area = makeArea()
    const { committed, deps: d } = deps(area, { urls: { 1: '' } })
    await d.store.put(stage({ attempts: 0 }))

    await drainPendingStages(d, NOW)

    expect(committed.map((s) => s.id)).toEqual(['stage-1'])
  })

  it('prunes before draining, so an expired stage is never retried', async () => {
    const area = makeArea()
    const { committed, deps: d } = deps(area, {
      urls: { 1: 'https://acme.example/jobs/1' },
    })
    await d.store.put(
      stage({ attempts: 2, id: 'ancient', stagedAt: NOW - STAGE_TTL_MS - 1 }),
    )

    await drainPendingStages(d, NOW)

    expect(committed).toEqual([])
    expect(await d.store.readAll()).toEqual([])
  })
})

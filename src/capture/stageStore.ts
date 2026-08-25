import type { AnswerCaptureRecord } from '~/bridge/types'

// The staged-capture store, lifted out of the background closure so the two
// properties that matter can actually be executed in a test: that two tabs
// staging at once do not erase each other, and that a submit whose navigation
// beats the write to disk still commits.
//
// Storage is injected rather than reached for. The background worker passes
// `browser.storage.session`; a test passes a map. Nothing here knows which.
export type CaptureStage = {
  applicationUrl: string
  ats: null | string
  attempts: number
  id: string
  lastError: null | string
  records: AnswerCaptureRecord[]
  talentJobApplicationId: null | string
  stagedAt: number
  tabId: null | number
}

// The slice of a chrome.storage area this needs. Narrower than the real type on
// purpose: `get(null)` returning everything is the only unusual call, and stating
// it here is what lets a plain object stand in.
export type StageStorageArea = {
  get(keys: null | string): Promise<Record<string, unknown>>
  remove(keys: string | string[]): Promise<void>
  set(items: Record<string, unknown>): Promise<void>
}

export type StageStore = {
  drop(stageId: string): Promise<void>
  pruneExpired(now: number): Promise<void>
  put(stage: CaptureStage): Promise<void>
  read(stageId: string): Promise<CaptureStage | null>
  readAll(): Promise<CaptureStage[]>
}

export const recordRetryableStageFailure = async (
  store: StageStore,
  stage: CaptureStage,
  error: string,
): Promise<CaptureStage> => {
  const failed = {
    ...stage,
    attempts: stage.attempts + 1,
    lastError: error,
  }
  await store.put(failed)
  return failed
}

export const STAGE_KEY_PREFIX = 'tp.captureStages'
export const STAGE_TTL_MS = 30 * 60 * 1000
export const STAGE_RETRY_LIMIT = 5

const keyFor = (id: string): string => `${STAGE_KEY_PREFIX}.${id}`

const isStageKey = (key: string): boolean =>
  key.startsWith(`${STAGE_KEY_PREFIX}.`)

// ONE STORAGE KEY PER STAGE, never a single map.
//
// A storage area has no transaction. Read-modify-write of one shared map is
// lost-update by construction: two tabs submitting at the same moment both read
// the map, both add their own stage, and whichever writes second erases the
// other's. The entire purpose of staging is to not lose a batch, so the store
// must not be capable of losing one. Per-key writes never touch each other's
// bytes.
//
// Pruning is a separate sweep rather than something every write performs, for
// the same reason: a cleanup that rewrote the whole map would clobber a
// concurrent insert.
export const createStageStore = (area: StageStorageArea): StageStore => ({
  drop: async (stageId) => {
    await area.remove(keyFor(stageId))
  },

  pruneExpired: async (now) => {
    const cutoff = now - STAGE_TTL_MS
    const all = await area.get(null)
    const stale = Object.entries(all)
      .filter(([key]) => isStageKey(key))
      .map(([key, value]) => [key, value as CaptureStage] as const)
      .filter(
        ([, stage]) =>
          !stage?.id ||
          stage.stagedAt < cutoff ||
          stage.attempts >= STAGE_RETRY_LIMIT,
      )
      .map(([key]) => key)

    if (stale.length > 0) await area.remove(stale)
  },

  put: async (stage) => {
    await area.set({ [keyFor(stage.id)]: stage })
  },

  read: async (stageId) => {
    const key = keyFor(stageId)
    const res = await area.get(key)
    return (res[key] as CaptureStage) ?? null
  },

  readAll: async () => {
    const all = await area.get(null)
    return Object.entries(all)
      .filter(([key]) => isStageKey(key))
      .map(([, value]) => value as CaptureStage)
      .filter((stage) => Boolean(stage?.id))
  },
})

export type StageDeps = {
  commit(stage: CaptureStage): Promise<unknown>
  store: StageStore
  // Where the staging tab is NOW. `null` means unknowable — no tab id, or no
  // permission to read the url — which is not evidence of navigation.
  tabUrl(tabId: number): Promise<null | string>
}

// Has the tab already left the page these answers were filled on?
//
// A vanished tab counts as having left: the page is gone, nothing will ever
// report the submit outcome, and the asymmetry documented at the background's
// onCommitted listener applies — a lost capture is unrecoverable, a spurious one
// is deletable.
export const tabLeftStagedPage = async (
  deps: StageDeps,
  stage: CaptureStage,
): Promise<boolean> => {
  if (stage.tabId === null) return false
  const url = await deps.tabUrl(stage.tabId)
  if (url === null) return false
  return url !== stage.applicationUrl
}

/**
 * Persist a stage, then close the race the persistence itself opens.
 *
 * `put` is asynchronous. A classic full-page submit can commit its navigation
 * while that write is still in flight, so the navigation listener looks for a
 * stage that does not exist yet, finds nothing, and the batch — written a moment
 * later with `attempts: 0` — is then retried by nothing, because the retry drain
 * deliberately leaves untried stages to their own page.
 *
 * So once the write has landed, ask the tab where it actually is. If it has
 * already left, the navigation this stage was waiting for has been and gone, and
 * this is that stage's commit.
 */
export const stageAndSettle = async (
  deps: StageDeps,
  stage: CaptureStage,
): Promise<{ committed: boolean }> => {
  await deps.store.put(stage)

  if (await tabLeftStagedPage(deps, stage)) {
    await deps.commit(stage)
    return { committed: true }
  }

  return { committed: false }
}

/**
 * Drain stages nothing else will finish.
 *
 * A stage that has already failed at least once is the worker's to retry. An
 * untried one belongs to its own page — unless that page is gone, which is the
 * same orphan the navigation listener handles, caught here for the case where
 * the worker was suspended before that event arrived.
 */
export const drainPendingStages = async (
  deps: StageDeps,
  now: number,
): Promise<void> => {
  await deps.store.pruneExpired(now)
  for (const stage of await deps.store.readAll()) {
    if (stage.attempts > 0 || (await tabLeftStagedPage(deps, stage))) {
      await deps.commit(stage)
    }
  }
}

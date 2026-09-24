import { describe, expect, it } from 'bun:test'

import {
  clearApplicationContextForTab,
  followApplicationNavigation,
  readApplicationContextForTab,
  readJobCountryForTab,
  registerApplicationHandoff,
  registerOpenedApplicationTab,
  updateOpenedApplicationTab,
  type ApplicationContextStorage,
} from './applicationContext'

const storage = () => {
  const values: Record<string, unknown> = {}
  const area: ApplicationContextStorage = {
    get: async (key) => ({ [key]: values[key] }),
    remove: async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]
    },
    set: async (items) => {
      Object.assign(values, items)
    },
  }
  return area
}

describe('application handoff context', () => {
  it('binds when the handoff arrives before the tab', async () => {
    const area = storage()
    await registerApplicationHandoff(
      area,
      10,
      'application-1',
      'https://ats.example/apply/1',
      100,
    )
    await registerOpenedApplicationTab(
      area,
      10,
      20,
      'https://ats.example/apply/1',
      101,
    )
    expect(await readApplicationContextForTab(area, 20)).toBe('application-1')
  })

  it('binds when the new tab event wins the race', async () => {
    const area = storage()
    await registerOpenedApplicationTab(
      area,
      10,
      20,
      'https://ats.example/apply/1',
      100,
    )
    await registerApplicationHandoff(
      area,
      10,
      'application-1',
      'https://ats.example/apply/1',
      101,
    )
    expect(await readApplicationContextForTab(area, 20)).toBe('application-1')
  })

  it('keeps a bound context while other tabs come and go', async () => {
    const area = storage()
    await registerApplicationHandoff(
      area,
      10,
      'application-1',
      'https://ats.example/apply/1',
      100,
    )
    await registerOpenedApplicationTab(
      area,
      10,
      20,
      'https://ats.example/apply/1',
      101,
    )
    await registerOpenedApplicationTab(
      area,
      99,
      30,
      'https://other.example/',
      10 * 60 * 1000 + 102,
    )
    expect(await readApplicationContextForTab(area, 20)).toBe('application-1')
  })

  it('does not bind a stale unpaired handoff', async () => {
    const area = storage()
    await registerApplicationHandoff(
      area,
      10,
      'application-1',
      'https://ats.example/apply/1',
      100,
    )
    await registerOpenedApplicationTab(
      area,
      10,
      20,
      'https://ats.example/apply/1',
      10 * 60 * 1000 + 101,
    )
    expect(await readApplicationContextForTab(area, 20)).toBeNull()
  })

  it('clears a bound context after capture or tab close', async () => {
    const area = storage()
    await registerApplicationHandoff(
      area,
      10,
      'application-1',
      'https://ats.example/apply/1',
      100,
    )
    await registerOpenedApplicationTab(
      area,
      10,
      20,
      'https://ats.example/apply/1',
      101,
    )
    await clearApplicationContextForTab(area, 20)
    expect(await readApplicationContextForTab(area, 20)).toBeNull()
  })

  it('does not let an unrelated opener child consume the handoff', async () => {
    const area = storage()
    await registerOpenedApplicationTab(
      area,
      10,
      19,
      'https://news.example/article',
      100,
    )
    await registerApplicationHandoff(
      area,
      10,
      'application-1',
      'https://ats.example/apply/1',
      101,
    )
    expect(await readApplicationContextForTab(area, 19)).toBeNull()

    await registerOpenedApplicationTab(area, 10, 20, 'about:blank', 102)
    await updateOpenedApplicationTab(
      area,
      10,
      20,
      'https://ats.example/apply/1',
      103,
    )
    expect(await readApplicationContextForTab(area, 20)).toBe('application-1')
  })

  it('keeps the job country the backend sent with the handoff', async () => {
    const area = storage()
    await registerApplicationHandoff(area, 10, 'application-1', 'https://ats.example/apply/1', 100, 'DE')
    await registerOpenedApplicationTab(area, 10, 20, 'https://ats.example/apply/1', 100)

    expect(await readJobCountryForTab(area, 20)).toBe('DE')
  })

  it('uses _unknown when the handoff has no valid job country', async () => {
    const area = storage()
    await registerApplicationHandoff(area, 10, 'application-1', 'https://ats.example/apply/1', 100, 'Germany')
    await registerOpenedApplicationTab(area, 10, 20, 'https://ats.example/apply/1', 100)

    expect(await readJobCountryForTab(area, 20)).toBe('_unknown')
    expect(await readJobCountryForTab(area, 99)).toBe('_unknown')
  })
})

describe('application context after navigation', () => {
  const destination = 'https://ats.example/apply/1?source=talentprofile'

  const bound = async () => {
    const area = storage()
    await registerApplicationHandoff(area, 10, 'application-1', destination, 100, 'DE')
    await registerOpenedApplicationTab(area, 10, 20, destination, 101)
    return area
  }

  const snapshot = async (area: ApplicationContextStorage) => [
    await readApplicationContextForTab(area, 20),
    await readJobCountryForTab(area, 20),
  ]

  it('keeps the context on the exact destination', async () => {
    const area = await bound()
    await followApplicationNavigation(area, { frameId: 0, tabId: 20, url: destination })

    expect(await snapshot(area)).toEqual(['application-1', 'DE'])
  })

  it('keeps the context when only the fragment changes', async () => {
    const area = await bound()
    await followApplicationNavigation(area, { frameId: 0, tabId: 20, url: `${destination}#questions` })

    expect(await snapshot(area)).toEqual(['application-1', 'DE'])
  })

  it.each([
    ['the path', 'https://ats.example/apply/2?source=talentprofile'],
    ['the query', 'https://ats.example/apply/1?source=search'],
    ['the origin', 'https://other-ats.example/apply/1?source=talentprofile'],
    ['the history state to another job', 'https://ats.example/apply/1/confirmation?source=talentprofile'],
  ])('clears application id and country together when %s changes', async (_, url) => {
    const area = await bound()
    await followApplicationNavigation(area, { frameId: 0, tabId: 20, url })

    expect(await snapshot(area)).toEqual([null, '_unknown'])
  })

  it('ignores a subframe navigation', async () => {
    const area = await bound()
    await followApplicationNavigation(area, { frameId: 7, tabId: 20, url: 'https://widget.example/embed' })

    expect(await snapshot(area)).toEqual(['application-1', 'DE'])
  })

  it('ignores a navigation in another tab', async () => {
    const area = await bound()
    await followApplicationNavigation(area, { frameId: 0, tabId: 21, url: 'https://news.example/' })

    expect(await snapshot(area)).toEqual(['application-1', 'DE'])
  })

  it('binds a new handoff normally after a clear', async () => {
    const area = await bound()
    await followApplicationNavigation(area, { frameId: 0, tabId: 20, url: 'https://ats.example/apply/2' })
    await registerApplicationHandoff(area, 20, 'application-2', 'https://ats.example/apply/3', 200, 'GB')
    await registerOpenedApplicationTab(area, 20, 30, 'https://ats.example/apply/3', 201)

    expect(await snapshot(area)).toEqual([null, '_unknown'])
    expect([await readApplicationContextForTab(area, 30), await readJobCountryForTab(area, 30)]).toEqual([
      'application-2',
      'GB',
    ])
  })

  it('treats a bound context without a destination as none and drops it on navigation', async () => {
    const area = storage()
    await area.set({ 'tp.applicationContext.tab.20': { applicationId: 'application-1', jobCountry: 'DE' } })

    expect(await snapshot(area)).toEqual([null, '_unknown'])
    await followApplicationNavigation(area, { frameId: 0, tabId: 20, url: destination })
    expect((await area.get('tp.applicationContext.tab.20'))['tp.applicationContext.tab.20'] === undefined).toBe(true)
  })

  it('reports _unknown for a tab that was never handed off', async () => {
    expect(await readJobCountryForTab(storage(), 20)).toBe('_unknown')
  })
})

import { describe, expect, it } from 'bun:test'

import {
  clearApplicationContextForTab,
  readApplicationContextForTab,
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

  it('keeps a bound context for the lifetime of the tab', async () => {
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
})

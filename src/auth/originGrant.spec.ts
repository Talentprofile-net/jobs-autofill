import { describe, expect, it } from 'bun:test'

import type { OriginMode } from '~/field/types'
import { enableGrantedOrigin, type OriginGrantDeps } from './originGrant'

const LEVER = 'https://jobs.lever.co/*'

type Over = Partial<{
  permitted: boolean | Error
  previous: OriginMode | null
  registerFails: boolean
  saveFails: boolean
}>

const harness = (over: Over = {}) => {
  const log: string[] = []
  const stored = new Map<string, OriginMode>()
  if (over.previous) stored.set(LEVER, over.previous)
  const registered = new Set<string>(over.previous ? [LEVER] : [])
  const deps: OriginGrantDeps = {
    broadcast: (pattern, mode) => {
      log.push(`broadcast ${mode}`)
    },
    hasPermission: async () => {
      log.push('permission')
      if (over.permitted instanceof Error) throw over.permitted
      return over.permitted ?? true
    },
    inject: () => {
      log.push('inject')
    },
    readMode: async (pattern) => stored.get(pattern) ?? null,
    register: async (pattern) => {
      log.push('register')
      if (over.registerFails) throw new Error('Duplicate script ID')
      registered.add(pattern)
    },
    save: async (pattern, mode) => {
      log.push('save')
      if (over.saveFails) throw new Error('QUOTA_BYTES quota exceeded')
      stored.set(pattern, mode)
    },
    unregister: async (pattern) => {
      log.push('unregister')
      registered.delete(pattern)
    },
  }
  return { deps, log, registered, stored }
}

describe('enableGrantedOrigin', () => {
  it('registers scripts before it saves the origin, then injects and broadcasts', async () => {
    const h = harness()
    expect(await enableGrantedOrigin(LEVER, 'application', h.deps)).toEqual({ ok: true })
    expect(h.log).toEqual(['permission', 'register', 'save', 'inject', 'broadcast application'])
    expect(h.stored.get(LEVER)).toBe('application')
    expect(h.registered.has(LEVER)).toBe(true)
  })

  it('leaves the origin disabled when script registration fails', async () => {
    const h = harness({ registerFails: true })
    expect(await enableGrantedOrigin(LEVER, 'application', h.deps)).toEqual({ error: 'Duplicate script ID', ok: false })
    expect(h.log).toEqual(['permission', 'register'])
    expect(h.stored.has(LEVER)).toBe(false)
  })

  it('rolls registered scripts back when saving the origin fails', async () => {
    const h = harness({ saveFails: true })
    expect(await enableGrantedOrigin(LEVER, 'application', h.deps)).toEqual({ error: 'QUOTA_BYTES quota exceeded', ok: false })
    expect(h.log).toEqual(['permission', 'register', 'save', 'unregister'])
    expect(h.registered.has(LEVER)).toBe(false)
    expect(h.stored.has(LEVER)).toBe(false)
  })

  it('keeps an already enabled origin running when a mode change fails to save', async () => {
    const h = harness({ previous: 'notesOnly', saveFails: true })
    expect((await enableGrantedOrigin(LEVER, 'application', h.deps)).ok).toBe(false)
    expect(h.log).toEqual(['permission', 'register', 'save'])
    expect(h.registered.has(LEVER)).toBe(true)
    expect(h.stored.get(LEVER)).toBe('notesOnly')
  })

  it('does nothing without the host permission', async () => {
    const h = harness({ permitted: false })
    expect(await enableGrantedOrigin(LEVER, 'application', h.deps)).toEqual({ error: 'Permission not granted', ok: false })
    expect(h.log).toEqual(['permission'])
    const thrown = harness({ permitted: new Error('Invalid pattern') })
    expect(await enableGrantedOrigin(LEVER, 'application', thrown.deps)).toEqual({ error: 'Invalid pattern', ok: false })
    expect(thrown.log).toEqual(['permission'])
  })

  it('is idempotent when the popup completes after the permission handler already did', async () => {
    const h = harness({ previous: 'application' })
    expect(await enableGrantedOrigin(LEVER, 'application', h.deps)).toEqual({ ok: true })
    expect(h.log).toEqual(['permission', 'register', 'save'])
  })

  it('only broadcasts when an enabled origin changes mode', async () => {
    const h = harness({ previous: 'notesOnly' })
    expect(await enableGrantedOrigin(LEVER, 'application', h.deps)).toEqual({ ok: true })
    expect(h.log).toEqual(['permission', 'register', 'save', 'broadcast application'])
  })
})

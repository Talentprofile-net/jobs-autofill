import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { installDom } from '~/core/__fixtures__/domGlobals'
import type { PickerApi } from './pickerApi'
import type { PickerContextData } from './protocol'

import * as donorStyle from '~/ui/donorStyle'

const actualDonorStyle = { ...donorStyle }
mock.module('~/ui/donorStyle', () => ({ ...actualDonorStyle, applyAppearanceVars: () => {} }))

const { createPickerPage } = await import('./pickerPage')

const HOST = 'host-top'

type Pending = { activation: string; resolve: (context: PickerContextData | null) => void }

let pending: Pending[] = []
let dismissed: string[] = []
let resized: string[] = []
let destroyed = 0
let observing = 0

const fieldContext = (fieldName: string): PickerContextData => ({
  appearance: null,
  descriptor: {
    fieldName,
    fieldType: 'TextInput',
    fieldUuid: `uuid-${fieldName}`,
    pickerMode: 'full',
    section: 'personal',
  },
  kind: 'field',
  maxHeight: 320,
  mobile: false,
  optionLabels: null,
  standardField: null,
  storageKey: 'tp.picker.path.test',
})

const fakeApi = (activation: string): PickerApi => {
  const api: Partial<PickerApi> = {
    context: () => new Promise((resolve) => pending.push({ activation, resolve })),
    dismiss: () => {
      dismissed.push(activation)
    },
    resize: () => {
      resized.push(activation)
    },
  }
  return api as PickerApi
}

const setup = () => {
  const root = document.documentElement
  const target = document.getElementById('app')
  if (!target) throw new Error('missing app')
  const page = createPickerPage({
    createApi: fakeApi,
    hostId: HOST,
    observe: () => {
      observing += 1
      return () => {
        observing -= 1
      }
    },
    render: (context, _api, mountTarget) => {
      const popover = document.createElement('div')
      popover.className = 'popover'
      popover.textContent = context.kind === 'field' ? `Secret answer for ${context.descriptor.fieldName}` : 'Fill?'
      mountTarget.appendChild(popover)
      return {
        destroy: () => {
          destroyed += 1
        },
      }
    },
    root,
    target,
  })
  return { page, root, target }
}

const resolve = async (activation: string, context: PickerContextData | null) => {
  const entry = pending.find((item) => item.activation === activation)
  if (!entry) throw new Error(`no pending context for ${activation}`)
  entry.resolve(context)
  await Promise.resolve()
  await Promise.resolve()
}

const signal = (kind: string, activation: string, extra: Record<string, unknown> = {}) => ({
  activation,
  hostId: HOST,
  kind,
  ...extra,
})

beforeEach(() => {
  installDom('<html><body><div id="app"></div></body></html>')
  pending = []
  dismissed = []
  resized = []
  destroyed = 0
  observing = 0
})

describe('persistent picker page', () => {
  it('renders the activation context and clears every answer while closed', async () => {
    const { page, root, target } = setup()
    page.onMessage(signal('picker.activate', 'a1'))
    await resolve('a1', fieldContext('first'))
    expect(target.textContent).toContain('Secret answer for first')
    expect(root.getAttribute('data-tp-active')).toBe('true')
    expect(observing).toBe(1)
    expect(resized).toEqual(['a1'])

    page.onMessage(signal('picker.deactivate', 'a1'))
    expect(target.textContent).toBe('')
    expect(target.children).toHaveLength(0)
    expect(root.getAttribute('data-tp-active')).toBeNull()
    expect(root.getAttribute('style')).toBeNull()
    expect(observing).toBe(0)
    expect(destroyed).toBe(1)
    expect(page.activeActivation()).toBeNull()
  })

  it('reopens with the new field and never renders a stale context', async () => {
    const { page, target } = setup()
    page.onMessage(signal('picker.activate', 'a1'))
    page.onMessage(signal('picker.activate', 'a2'))
    await resolve('a1', fieldContext('first'))
    expect(target.textContent).toBe('')
    await resolve('a2', fieldContext('second'))
    expect(target.textContent).toBe('Secret answer for second')
    expect(target.children).toHaveLength(1)
    expect(page.activeActivation()).toBe('a2')
  })

  it('stays closed when the context arrives after a deactivation', async () => {
    const { page, target } = setup()
    page.onMessage(signal('picker.activate', 'a1'))
    page.onMessage(signal('picker.deactivate', 'a1'))
    await resolve('a1', fieldContext('first'))
    expect(target.textContent).toBe('')
    expect(observing).toBe(0)
  })

  it('ignores signals for another host or an earlier activation', async () => {
    const { page, root, target } = setup()
    page.onMessage({ ...signal('picker.activate', 'other'), hostId: 'host-inner' })
    expect(pending).toHaveLength(0)
    page.onMessage(signal('picker.activate', 'a1'))
    await resolve('a1', fieldContext('first'))
    page.onMessage(signal('picker.deactivate', 'a0'))
    page.onMessage(signal('picker.layout', 'a0', { maxHeight: 999 }))
    expect(target.textContent).toBe('Secret answer for first')
    expect(root.style.getPropertyValue('--tp-picker-max-height')).toBe('320px')
    page.onMessage(signal('picker.layout', 'a1', { maxHeight: 480 }))
    expect(root.style.getPropertyValue('--tp-picker-max-height')).toBe('480px')
  })

  it('dismisses an activation whose context is gone', async () => {
    const { page, target } = setup()
    page.onMessage(signal('picker.activate', 'a1'))
    await resolve('a1', null)
    expect(dismissed).toEqual(['a1'])
    expect(target.textContent).toBe('')
  })
})

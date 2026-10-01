import { mount } from 'svelte'
import { browser } from 'wxt/browser'

import FillConfirm from '~/ui/picker/FillConfirm.svelte'
import PickerPopover from '~/ui/picker/PickerPopover.svelte'
import { createPickerApi } from '~/ui/picker/pickerApi'
import { PICKER_PAGE_STYLE } from '~/ui/picker/pickerStyles'
import type { PickerLayout } from '~/ui/picker/protocol'
import { applyAppearanceVars } from '~/ui/donorStyle'

const root = document.documentElement
const sessionId = location.hash.slice(1)
const api = createPickerApi(sessionId)

const style = document.createElement('style')
style.textContent = PICKER_PAGE_STYLE
document.head.appendChild(style)

const setMaxHeight = (px: number) => root.style.setProperty('--tp-picker-max-height', `${px}px`)

const isLayout = (message: unknown): message is PickerLayout =>
  typeof message === 'object' &&
  message !== null &&
  'kind' in message &&
  message.kind === 'picker.layout' &&
  'sessionId' in message &&
  message.sessionId === sessionId

browser.runtime.onMessage.addListener((message: unknown) => {
  if (isLayout(message)) setMaxHeight(message.maxHeight)
})

const start = async () => {
  const context = await api.context()
  const target = document.getElementById('app')
  if (!context || !target) {
    api.dismiss()
    return
  }
  root.setAttribute('data-tp-mobile', context.mobile ? 'true' : 'false')
  setMaxHeight(context.maxHeight)
  if (context.appearance) applyAppearanceVars(root, context.appearance, 'tp-picker')

  if (context.kind === 'confirmFill') {
    mount(FillConfirm, { props: { api }, target })
  } else {
    mount(PickerPopover, { props: { api, context, onClose: api.dismiss }, target })
  }

  const popover = document.querySelector<HTMLElement>('.popover')
  if (!popover) return
  const report = () => api.resize(Math.ceil(popover.getBoundingClientRect().height))
  new ResizeObserver(report).observe(popover)
  report()
}

void start()

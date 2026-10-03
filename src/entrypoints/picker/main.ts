import { mount, unmount } from 'svelte'
import { browser } from 'wxt/browser'

import FillConfirm from '~/ui/picker/FillConfirm.svelte'
import PickerPopover from '~/ui/picker/PickerPopover.svelte'
import { announcePickerReady, createPickerApi } from '~/ui/picker/pickerApi'
import { createPickerPage } from '~/ui/picker/pickerPage'
import { PICKER_PAGE_STYLE } from '~/ui/picker/pickerStyles'

const hostId = location.hash.slice(1)
const target = document.getElementById('app')

const style = document.createElement('style')
style.textContent = PICKER_PAGE_STYLE
document.head.appendChild(style)

if (target && hostId) {
  const page = createPickerPage({
    createApi: (activation) => createPickerApi(hostId, activation),
    hostId,
    observe: (element, report) => {
      const observer = new ResizeObserver(report)
      observer.observe(element)
      return () => observer.disconnect()
    },
    render: (context, api, mountTarget) => {
      const component =
        context.kind === 'confirmFill'
          ? mount(FillConfirm, { props: { api }, target: mountTarget })
          : mount(PickerPopover, { props: { api, context, onClose: api.dismiss }, target: mountTarget })
      return { destroy: () => void unmount(component) }
    },
    root: document.documentElement,
    target,
  })
  browser.runtime.onMessage.addListener((message: unknown) => {
    page.onMessage(message)
  })
  announcePickerReady(hostId)
}

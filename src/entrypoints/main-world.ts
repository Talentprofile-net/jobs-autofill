import { defineContentScript } from 'wxt/utils/define-content-script'
import { startObserver } from '~/field/registry'

export default defineContentScript({
  matches: [
    'https://*.myworkdayjobs.com/*',
    'https://boards.greenhouse.io/*',
    'https://job-boards.greenhouse.io/*',
  ],
  allFrames: true,
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
    if ((window as { __tp_main_world_loaded?: boolean }).__tp_main_world_loaded) {
      return
    }
    ;(window as { __tp_main_world_loaded?: boolean }).__tp_main_world_loaded = true
    const cleanup = startObserver()
    window.addEventListener('beforeunload', () => {
      cleanup()
    })
  },
})
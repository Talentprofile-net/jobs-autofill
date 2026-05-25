import { defineContentScript } from 'wxt/utils/define-content-script'
import { startContentBridge } from '~/bridge/contentBridge'
import { detectAts } from '~/core/ats'

export default defineContentScript({
  matches: [
    'https://*.myworkdayjobs.com/*',
    'https://boards.greenhouse.io/*',
    'https://job-boards.greenhouse.io/*',
  ],
  allFrames: true,
  runAt: 'document_idle',
  main() {
    startContentBridge(detectAts())
  },
})
import { browser } from 'wxt/browser'

import type { DraftSource } from '~/api/coverLetter'
import { readApplicationContextForTab, type ApplicationContextStorage } from './applicationContext'
import { readPageJob } from './pageJob'

export const tabDraftSource = async (storage: ApplicationContextStorage, tabId: number): Promise<DraftSource> => {
  const applicationId = await readApplicationContextForTab(storage, tabId)
  if (applicationId) return { applicationId, job: null }
  const job = await browser.tabs.sendMessage(tabId, { kind: 'page.job' }, { frameId: 0 }).catch(() => null)
  return { applicationId: null, job: readPageJob(job) }
}

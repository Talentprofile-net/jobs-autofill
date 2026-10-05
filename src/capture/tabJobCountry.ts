import { browser } from 'wxt/browser'

import type { AnswerCaptureRecord } from '~/bridge/types'
import { normalizeJobCountry, UNKNOWN_JOB_COUNTRY } from '~/classifier/jobCountry'
import { readJobCountryForTab, type ApplicationContextStorage } from './applicationContext'

export const tabJobCountry = async (
  storage: ApplicationContextStorage,
  tabId: number | null | undefined,
): Promise<string> => {
  if (tabId === null || tabId === undefined) return UNKNOWN_JOB_COUNTRY
  const bound = await readJobCountryForTab(storage, tabId)
  if (bound !== UNKNOWN_JOB_COUNTRY) return bound
  return normalizeJobCountry(
    await browser.tabs.sendMessage(tabId, { kind: 'page.jobCountry' }, { frameId: 0 }).catch(() => null),
  )
}

export const withJobCountry = (records: AnswerCaptureRecord[], jobCountry: string): AnswerCaptureRecord[] =>
  records.map((record) => ({ ...record, jobCountry: jobCountry === UNKNOWN_JOB_COUNTRY ? null : jobCountry }))

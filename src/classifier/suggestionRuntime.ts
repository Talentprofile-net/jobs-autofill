import { browser } from 'wxt/browser'

import type { TalentAnswer } from '~/api/types'
import type { ApplicationContextStorage } from '~/capture/applicationContext'
import { createAnswerLabels } from './answerLabels'
import { tabJobCountry } from '~/capture/tabJobCountry'
import { classifyWithRuntime, closeOffscreenDocument } from './offscreenClient'
import { createSuggestionService } from './suggestionService'
import { readClassifierSuggestions } from './suggestionSwitch'

const namedLabels = (file: unknown): Map<string, string> => {
  const names = new Map<string, string>()
  const labels = typeof file === 'object' && file !== null && 'labels' in file ? file.labels : null
  if (!Array.isArray(labels)) throw new Error('the staged label map has no labels')
  for (const entry of labels) {
    if (typeof entry?.labelEnumId === 'string' && typeof entry?.label === 'string') {
      names.set(entry.labelEnumId, entry.label)
    }
  }
  return names
}

let labelNames: Promise<Map<string, string>> | null = null

const loadLabelNames = (): Promise<Map<string, string>> => {
  labelNames ??= fetch(browser.runtime.getURL('/classifier/labels.json'))
    .then((response): Promise<unknown> => response.json())
    .then(namedLabels)
    .catch((error: unknown) => {
      labelNames = null
      throw error
    })
  return labelNames
}

const answerLabels = createAnswerLabels(
  {
    get: (key) => browser.storage.session.get(key),
    set: (items) => browser.storage.session.set(items),
  },
  classifyWithRuntime,
)

export const browserSuggestionService = (
  contextStorage: ApplicationContextStorage,
  answers: () => Promise<TalentAnswer[]>,
) =>
  createSuggestionService({
    answerLabels,
    answers,
    classify: classifyWithRuntime,
    enabled: () => readClassifierSuggestions(browser.storage.local),
    jobCountry: (tabId) => tabJobCountry(contextStorage, tabId),
    labelNames: loadLabelNames,
    release: closeOffscreenDocument,
  })

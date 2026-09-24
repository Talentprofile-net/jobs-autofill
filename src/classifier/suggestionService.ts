import type { TalentAnswer } from '~/api/types'
import {
  readSuggestionRequest,
  suggestAnswer,
  type Suggestion,
  type SuggestionDependencies,
  type SuggestionRequest,
} from './suggest'

export type SuggestionServiceDependencies = {
  enabled: () => Promise<boolean>
  answers: () => Promise<TalentAnswer[]>
  jobCountry: (tabId: number | undefined) => Promise<string>
  labelNames: () => Promise<Map<string, string>>
  release: () => Promise<void>
  classify: SuggestionDependencies['classify']
  answerLabels: SuggestionDependencies['answerLabels']
}

const suggestSafely = async (
  dependencies: SuggestionServiceDependencies,
  request: SuggestionRequest,
  tabId: number | undefined,
): Promise<Suggestion> => {
  try {
    const [answers, jobCountry] = await Promise.all([dependencies.answers(), dependencies.jobCountry(tabId)])
    return await suggestAnswer(request, answers, jobCountry, {
      answerLabels: dependencies.answerLabels,
      classify: dependencies.classify,
      labelName: async (labelEnumId) => (await dependencies.labelNames()).get(labelEnumId) ?? labelEnumId,
    })
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), status: 'unavailable' }
  }
}

export const createSuggestionService =
  (dependencies: SuggestionServiceDependencies) =>
  async (raw: unknown, tabId: number | undefined): Promise<Suggestion> => {
    if (!(await dependencies.enabled())) return { status: 'disabled' }
    const request = readSuggestionRequest(raw)
    if (!request) return { error: 'invalid suggestion request', status: 'unavailable' }
    const suggestion = await suggestSafely(dependencies, request, tabId)
    if (await dependencies.enabled()) return suggestion
    await dependencies.release().catch(() => {})
    return { status: 'disabled' }
  }

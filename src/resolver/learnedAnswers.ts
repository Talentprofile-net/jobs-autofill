import type { Profile } from '~/api/types'
import type { ProfileValue } from '~/field/types'
import { findLearnedAnswer, learnedAnswerToProfileValue } from './learnedAnswerMatcher'

export type LearnedAnswerRequest = {
  requestId: string
  fieldName: string
  fieldType: string
  section: string
}

export type LearnedAnswerResult = {
  requestId: string
  value: ProfileValue
  matchedAnswerId: string | null
}

export const resolveLearnedAnswersBatch = (
  requests: LearnedAnswerRequest[],
  profile: Profile,
): LearnedAnswerResult[] => {
  const answers = profile.talentAnswers ?? []
  if (answers.length === 0) {
    return requests.map((r) => ({
      requestId: r.requestId,
      value: { kind: 'unsupported' },
      matchedAnswerId: null,
    }))
  }

  return requests.map((r) => {
    const match = findLearnedAnswer(r.fieldName, r.fieldType, answers)
    if (!match) {
      return {
        requestId: r.requestId,
        value: { kind: 'unsupported' },
        matchedAnswerId: null,
      }
    }
    const value = learnedAnswerToProfileValue(match, r.fieldType)
    return {
      requestId: r.requestId,
      value,
      matchedAnswerId: value.kind === 'unsupported' ? null : match.answer.id,
    }
  })
}
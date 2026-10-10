import type { Profile } from '~/api/types'
import type { ProfileValue } from '~/field/types'
import { isAlternateIdentityQuestion } from './alternateIdentity'
import { answersForJob } from './countryScopedAnswers'
import { findExactLearnedAnswer, findLearnedAnswer, learnedAnswerToProfileValue } from './learnedAnswerMatcher'
import { isNamePronunciationQuestion } from './namePronunciation'

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
  jobCountry: string,
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
    if (isAlternateIdentityQuestion(r.fieldName)) {
      return { requestId: r.requestId, value: { kind: 'unsupported' }, matchedAnswerId: null }
    }
    const find = isNamePronunciationQuestion(r.fieldName) ? findExactLearnedAnswer : findLearnedAnswer
    const match = find(r.fieldName, r.fieldType, answersForJob(answers, r.fieldName, jobCountry))
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
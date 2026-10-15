import type { Profile } from '~/api/types'
import type { ProfileValue } from '~/field/types'
import { isAlternateIdentityQuestion } from './alternateIdentity'
import { answersForJob } from './countryScopedAnswers'
import { answersForApplication } from './coverLetter'
import { findExactLearnedAnswer, findLearnedAnswer, learnedAnswerToProfileValue } from './learnedAnswerMatcher'
import { isNamePronunciationQuestion } from './namePronunciation'
import { isRefusedSection } from './questionTopics'

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
  applicationId: string | null = null,
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
    if (isAlternateIdentityQuestion(r.fieldName) || isRefusedSection(r.section ?? '')) {
      return { requestId: r.requestId, value: { kind: 'unsupported' }, matchedAnswerId: null }
    }
    const find = isNamePronunciationQuestion(r.fieldName) ? findExactLearnedAnswer : findLearnedAnswer
    const reusable = answersForApplication(answersForJob(answers, r.fieldName, jobCountry), r.fieldName, applicationId)
    const match = find(r.fieldName, r.fieldType, reusable)
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
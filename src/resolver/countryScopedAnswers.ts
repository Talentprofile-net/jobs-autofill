import type { TalentAnswer } from '~/api/types'
import { UNKNOWN_JOB_COUNTRY } from '~/classifier/jobCountry'

const AUTHORIZATION =
  /\b(authori[sz](ed|ation)|eligib(le|ility)|legally|right to work|work permit|sponsor(ed|ship)?|visas?|citizen(s|ship)?|permanent resident|green card|immigration|nationality|export control)\b/i

const RELOCATION = /\brelocat(e|ion)\b/i

export const isAuthorizationQuestion = (questionText: string): boolean =>
  AUTHORIZATION.test(questionText)

export const isCountryScopedQuestion = (questionText: string): boolean =>
  AUTHORIZATION.test(questionText) || RELOCATION.test(questionText)

export const answersForJob = (
  answers: TalentAnswer[],
  questionText: string,
  jobCountry: string,
): TalentAnswer[] => {
  if (!isCountryScopedQuestion(questionText)) return answers
  if (jobCountry === UNKNOWN_JOB_COUNTRY) return []
  return answers.filter((answer) => answer.jobCountry === jobCountry)
}

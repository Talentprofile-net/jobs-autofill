import type { TalentAnswer } from '~/api/types'

export const COVER_LETTER_QUESTION =
  /\b(cover|motivation(al)?)\s*letter\b|\bletter\s+of\s+(interest|intent|motivation)\b/i

export const isCoverLetterQuestion = (questionText: string): boolean => COVER_LETTER_QUESTION.test(questionText)

const sameApplication = (answer: TalentAnswer, applicationId: string | null): boolean =>
  applicationId !== null && answer.talentJobApplicationId === applicationId

export const answersForApplication = (
  answers: TalentAnswer[],
  questionText: string,
  applicationId: string | null,
): TalentAnswer[] => {
  const live = isCoverLetterQuestion(questionText)
  return answers.filter(
    (answer) => !(live || isCoverLetterQuestion(answer.questionText)) || sameApplication(answer, applicationId),
  )
}

import type { FieldResolveRequest, FieldResolveResult, FillValueResult } from './types'
import type { LearnedAnswerResult } from '~/resolver/learnedAnswers'

type FieldRequest = FieldResolveRequest & { requestId: string }

const resolvedByProfile = (result: FieldResolveResult | undefined): boolean =>
  result !== undefined && result.value.kind !== 'unsupported'

export const fieldsWithoutProfileValue = (
  fields: FieldRequest[],
  profile: FieldResolveResult[],
): FieldRequest[] => {
  const byId = new Map(profile.map((r) => [r.requestId, r]))
  return fields.filter((f) => !resolvedByProfile(byId.get(f.requestId)))
}

export const mergeFillValues = (
  fields: FieldRequest[],
  profile: FieldResolveResult[],
  learned: LearnedAnswerResult[],
): FillValueResult[] => {
  const profileById = new Map(profile.map((r) => [r.requestId, r]))
  const learnedById = new Map(learned.map((r) => [r.requestId, r]))
  return fields.map((field) => {
    const fromProfile = profileById.get(field.requestId)
    if (fromProfile && resolvedByProfile(fromProfile)) {
      return {
        matchedAnswerId: null,
        profileField: fromProfile.profileField,
        requestId: field.requestId,
        value: fromProfile.value,
      }
    }
    const fromAnswers = learnedById.get(field.requestId)
    if (fromAnswers && fromAnswers.value.kind !== 'unsupported' && fromAnswers.value.kind !== 'timeout') {
      return {
        matchedAnswerId: fromAnswers.matchedAnswerId,
        profileField: null,
        requestId: field.requestId,
        value: fromAnswers.value,
      }
    }
    return {
      matchedAnswerId: null,
      profileField: fromProfile?.profileField ?? null,
      requestId: field.requestId,
      value: fromProfile?.value ?? { kind: 'unsupported' },
    }
  })
}

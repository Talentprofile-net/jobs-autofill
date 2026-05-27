import { apiFetch, ApiError } from './client'
import type { ProfileValue } from '~/field/types'
import type { TalentAnswer } from './types'

const REUSE_WINDOW_MS = 24 * 60 * 60 * 1000

type ResolverOutcome = 'filled' | 'skipped' | 'unsupported' | 'failed'

export type CaptureAnswerInput = {
  questionText: string
  normalizedQuestion: string
  fieldType: string
  section: string | null
  answerKind: string
  answerValue: ProfileValue
  answerText: string | null
  pageUrl: string | null
  ats: string | null
  source: 'manual' | 'correction' | 'resolver_filled' | 'resolver_skipped'
  resolverOutcome: ResolverOutcome
  profileField: string | null
  talentJobApplicationId: string | null
  sourceAnswerId: string | null
}

type TalentJobApplicationStub = {
  id: string
  talentProfileId: string
  originalJobPostUrl: string | null
  createdAt: string
  updatedAt: string
}

export const findOrCreateApplicationByUrl = async (
  originalJobPostUrl: string,
): Promise<TalentJobApplicationStub> => {
  const cutoffIso = new Date(Date.now() - REUSE_WINDOW_MS).toISOString()
  const query = new URLSearchParams({
    where: JSON.stringify({
      originalJobPostUrl: { equals: originalJobPostUrl },
      createdAt: { gte: cutoffIso },
    }),
    orderBy: JSON.stringify({ createdAt: 'desc' }),
    take: '1',
  })
  const existing = await apiFetch<TalentJobApplicationStub[]>(
    `/api/v1/talentjobapplication?${query.toString()}`,
    { method: 'GET' },
  )
  if (existing && existing.length > 0) {
    return existing[0]
  }

  const created = await apiFetch<TalentJobApplicationStub>(
    '/api/v1/talentjobapplication',
    {
      method: 'POST',
      body: JSON.stringify({
        data: { originalJobPostUrl },
      }),
    },
  )
  if (!created) {
    throw new ApiError(0, 'Create application returned no body')
  }
  return created
}

const buildAnswerPayload = (input: CaptureAnswerInput) => ({
  questionText: input.questionText,
  normalizedQuestion: input.normalizedQuestion,
  fieldType: input.fieldType,
  section: input.section,
  answerKind: input.answerKind,
  answerValue: input.answerValue,
  answerText: input.answerText,
  pageUrl: input.pageUrl,
  ats: input.ats,
  source: input.source,
  resolverOutcome: input.resolverOutcome,
  profileField: input.profileField,
  talentJobApplicationId: input.talentJobApplicationId,
  sourceAnswerId: input.sourceAnswerId,
  lastUsedAt: new Date().toISOString(),
})

export const createTalentAnswer = async (
  input: CaptureAnswerInput,
): Promise<TalentAnswer> => {
  const created = await apiFetch<TalentAnswer>('/api/v1/talentanswer', {
    method: 'POST',
    body: JSON.stringify({
      data: buildAnswerPayload(input),
    }),
  })
  if (!created) {
    throw new ApiError(0, 'Create answer returned no body')
  }
  return created
}

export const upsertTalentAnswerForApplication = async (
  input: CaptureAnswerInput,
): Promise<TalentAnswer> => {
  if (!input.talentJobApplicationId) {
    throw new ApiError(
      0,
      'upsertTalentAnswerForApplication requires talentJobApplicationId',
    )
  }
  const upserted = await apiFetch<TalentAnswer>('/api/v1/talentanswer', {
    method: 'PUT',
    body: JSON.stringify({
      where: {
        talentProfileId_talentJobApplicationId_normalizedQuestion: {
          talentJobApplicationId: input.talentJobApplicationId,
          normalizedQuestion: input.normalizedQuestion,
        },
      },
      data: buildAnswerPayload(input),
    }),
  })
  if (!upserted) {
    throw new ApiError(0, 'Upsert answer returned no body')
  }
  return upserted
}

export const touchTalentAnswer = async (id: string): Promise<void> => {
  await apiFetch('/api/v1/talentanswer', {
    method: 'PUT',
    body: JSON.stringify({
      where: { id },
      data: { lastUsedAt: new Date().toISOString() },
    }),
  })
}

export const deleteTalentAnswer = async (id: string): Promise<void> => {
  await apiFetch('/api/v1/talentanswer', {
    method: 'DELETE',
    body: JSON.stringify({ where: { id } }),
  })
}
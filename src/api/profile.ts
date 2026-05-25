import { apiFetch, ApiError } from './client'
import type { Profile } from './types'

export const fetchMyProfile = async (): Promise<Profile> => {
  const profile = await apiFetch<Profile>('/api/v1/talentprofile/first', { method: 'GET' })
  if (!profile) {
    throw new ApiError(0, 'Profile endpoint returned no body')
  }
  return profile
}
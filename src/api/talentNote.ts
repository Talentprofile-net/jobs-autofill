import { apiFetch } from './client'
import type { ProfileNote } from './types'

// Notes are NOT part of the profile projection: `/talentprofile/first` feeds
// company-facing search and must never carry the talent's private notes. The
// talentNote route forces the caller's own profile, so it is the only read.
export const fetchMyTalentNotes = async (): Promise<ProfileNote[]> =>
  (await apiFetch<ProfileNote[]>('/api/v1/talentnote', { method: 'GET' })) ?? []

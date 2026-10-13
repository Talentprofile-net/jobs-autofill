import { apiFetch, ApiError } from './client'
import type { Profile, ProfileEducationEntry, ProfileExperienceEntry } from './types'

type StoredDates = {
  end?: string | null
  endDate?: string | null
  isCurrent?: boolean | null
  ongoing?: boolean | null
  start?: string | null
  startDate?: string | null
}

type StoredProfile = Omit<Profile, 'education' | 'experience'> & {
  education: Array<Partial<ProfileEducationEntry> & StoredDates & { id: string }> | null
  experience: Array<Partial<ProfileExperienceEntry> & StoredDates & { id: string }> | null
}

const datesOf = (entry: StoredDates) => ({
  endDate: entry.endDate ?? entry.end ?? null,
  isCurrent: entry.isCurrent ?? entry.ongoing ?? null,
  startDate: entry.startDate ?? entry.start ?? null,
})

export const normalizeProfile = (stored: StoredProfile): Profile => ({
  ...stored,
  education:
    stored.education?.map((entry) => ({
      degree: entry.degree ?? null,
      description: entry.description ?? null,
      fieldOfStudy: entry.fieldOfStudy ?? null,
      gpa: entry.gpa ?? null,
      id: entry.id,
      location: entry.location ?? null,
      school: entry.school ?? null,
      ...datesOf(entry),
    })) ?? null,
  experience:
    stored.experience?.map((entry) => ({
      company: entry.company ?? null,
      description: entry.description ?? null,
      employmentType: entry.employmentType ?? null,
      id: entry.id,
      location: entry.location ?? null,
      title: entry.title ?? null,
      ...datesOf(entry),
    })) ?? null,
})

export const fetchMyProfile = async (): Promise<Profile> => {
  const profile = await apiFetch<StoredProfile>('/api/v1/talentprofile/first', { method: 'GET' })
  if (!profile) {
    throw new ApiError(0, 'Profile endpoint returned no body')
  }
  return normalizeProfile(profile)
}

import type { Profile } from '~/api/types'
import type { ProfileScoreItems } from '~/bridge/types'

type ScoreResult = {
  profileScore: number
  scoreItems: ProfileScoreItems
}

const WEIGHTS = {
  profileName: 1,
  jobTitle: 1,
  totalExperience: 3,
  descriptionLong: 10,
  descriptionShort: 5,
  location: 10,
  rate: 10,
  skillPoint: 5,
  skillsMax: 6,
  languages: 10,
  experience: 10,
  education: 10,
} as const

export const MAX_PROFILE_SCORE =
  WEIGHTS.profileName +
  WEIGHTS.jobTitle +
  WEIGHTS.totalExperience +
  WEIGHTS.descriptionLong +
  WEIGHTS.location +
  WEIGHTS.rate +
  WEIGHTS.skillPoint * WEIGHTS.skillsMax +
  WEIGHTS.languages +
  WEIGHTS.experience +
  WEIGHTS.education

export const calculateProfileScore = (profile: Profile): ScoreResult => {
  const hasName = !!profile.profileName && profile.profileName.length > 0
  const hasJobTitle = !!profile.jobTitle
  const hasTotalExperience = !!profile.totalExperience

  const descLen = profile.description?.length ?? 0
  const description: 'long' | 'short' | 'missing' =
    descLen >= 100 ? 'long' : descLen > 0 ? 'short' : 'missing'

  const hasLocation = !!profile.location
  const hasRate = !!profile.rateCurrency || !!profile.monthlyRate || !!profile.hourlyRate

  const skillsCount = Array.isArray(profile.skills) ? profile.skills.length : 0
  const hasSkills = skillsCount >= WEIGHTS.skillsMax

  const languagesCount = Array.isArray(profile.languages) ? profile.languages.length : 0
  const hasLanguages = languagesCount > 0

  const experienceCount = Array.isArray(profile.experience) ? profile.experience.length : 0
  const hasExperience = experienceCount > 0

  const educationCount = Array.isArray(profile.education) ? profile.education.length : 0
  const hasEducation = educationCount > 0

  let score = 0
  if (hasName) score += WEIGHTS.profileName
  if (hasJobTitle) score += WEIGHTS.jobTitle
  if (hasTotalExperience) score += WEIGHTS.totalExperience

  if (description === 'long') score += WEIGHTS.descriptionLong
  else if (description === 'short') score += WEIGHTS.descriptionShort

  if (hasLocation) score += WEIGHTS.location
  if (hasRate) score += WEIGHTS.rate

  if (skillsCount > 0) {
    score += Math.min(skillsCount, WEIGHTS.skillsMax) * WEIGHTS.skillPoint
  }

  if (hasLanguages) score += WEIGHTS.languages
  if (hasExperience) score += WEIGHTS.experience
  if (hasEducation) score += WEIGHTS.education

  const scoreItems: ProfileScoreItems = {
    profileName: hasName,
    jobTitle: hasJobTitle,
    description,
    location: hasLocation,
    rate: hasRate,
    totalExperience: hasTotalExperience,
    skills: hasSkills,
    languages: hasLanguages,
    experience: hasExperience,
    education: hasEducation,
  }

  return { profileScore: score, scoreItems }
}
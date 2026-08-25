export type ProfileLink = {
  id: string
  label: 'github' | 'linkedin' | 'other'
  url: string
}

export type ProfileLanguage = {
  id: string
  language: string
  rate: number
}

export type ProfileSkill = {
  id: string
  skill: string
  rate: number
}

export type ProfileEducationEntry = {
  id: string
  school: string | null
  degree: string | null
  fieldOfStudy: string | null
  startDate: string | null
  endDate: string | null
  isCurrent: boolean | null
  description: string | null
  gpa: string | null
  location: string | null
}

export type ProfileExperienceEntry = {
  id: string
  company: string | null
  title: string | null
  employmentType: string | null
  startDate: string | null
  endDate: string | null
  isCurrent: boolean | null
  description: string | null
  location: string | null
}

export type ProfileNote = {
  id: string
  content: string
  lastUsedAt: string | null
  createdAt: string
  updatedAt: string
}

export type Profile = {
  id: string
  profileName: string | null
  jobTitle: string | null
  description: string | null
  location: string | null
  totalExperience: string | null
  hourlyRate: string | null
  monthlyRate: string | null
  rateCurrency: string | null
  isAvailableForHire: boolean | null
  isInterestedInRelocation: boolean | null
  links: ProfileLink[] | null
  languages: ProfileLanguage[] | null
  skills: ProfileSkill[] | null
  education: ProfileEducationEntry[] | null
  experience: ProfileExperienceEntry[] | null
  talentNotes: ProfileNote[] | null
  talentAnswers: TalentAnswer[] | null
  user: {
    email: string | null
    phoneNumber: string | null
  } | null
}

export type AuthResponse = {
  token: string
  refreshToken: string
}

export type ApiErrorPayload = {
  status: number
  message: string
}

export type TalentAnswer = {
  id: string
  talentProfileId: string
  talentJobApplicationId: string | null
  sourceAnswerId: string | null
  questionText: string
  normalizedQuestion: string
  fieldType: string
  section: string | null
  answerKind: string
  answerValue: unknown
  answerText: string | null
  pageUrl: string | null
  ats: string | null
  source: string | null
  // The classifier's enum, and the key answer history will be queried by. It is
  // null on every row today: the country-aware classifier that fills it does not
  // exist yet, and nothing infers one. The field is declared because the column
  // is real, the backend returns it, and enum-driven matching cannot be built
  // against a type that pretends it is absent.
  labelEnumId: string | null
  profileField: string | null
  resolverOutcome: 'filled' | 'skipped' | 'unsupported' | 'failed' | null
  lastUsedAt: string | null
  createdAt: string
  updatedAt: string
}
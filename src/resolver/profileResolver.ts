import type {
  Profile,
  ProfileEducationEntry,
  ProfileExperienceEntry,
  ProfileLink,
} from '~/api/types'
import type { ProfileValue } from '~/field/types'
import { parseLocation, type ParsedLocation } from './parseLocation'
import { parseDate, type ParsedDate } from './parseDate'
import { parseSection, type ParsedSection } from './sectionParser'

const TEXT_FIELD_TYPES = new Set(['TextInput', 'ContentEditable'])

export type ResolveResult = {
  value: ProfileValue
  profileField: string | null
}

const unsupported = (): ResolveResult => ({
  value: { kind: 'unsupported' },
  profileField: null,
})

const withField = (
  value: ProfileValue,
  profileField: string | null,
): ResolveResult => ({ value, profileField })

const splitName = (full: string | null): { first: string; last: string } => {
  if (!full) return { first: '', last: '' }
  const trimmed = full.trim()
  const parts = trimmed.split(/\s+/)
  if (parts.length === 0) return { first: '', last: '' }
  if (parts.length === 1) return { first: parts[0], last: '' }
  return { first: parts[0], last: parts[parts.length - 1] }
}

const middleName = (full: string | null): string => {
  if (!full) return ''
  const parts = full.trim().split(/\s+/)
  if (parts.length <= 2) return ''
  return parts.slice(1, -1).join(' ')
}

const findLink = (
  links: ProfileLink[] | null,
  label: ProfileLink['label'],
): string => links?.find((l) => l.label === label)?.url ?? ''

const str = (value: string, confidence: 'exact' | 'guess' = 'exact'): ProfileValue =>
  ({ kind: 'string', value, confidence })

const bool = (value: boolean): ProfileValue => ({ kind: 'boolean', value })

const choice = (preferred: string, fallbacks: string[] = []): ProfileValue =>
  ({ kind: 'choice', preferred, fallbacks })

const multiChoice = (
  preferred: string[],
  fallbacks: string[] = [],
): ProfileValue => ({ kind: 'multiChoice', preferred, fallbacks })

const yesNoValue = (value: boolean, fieldType: string): ProfileValue => {
  if (fieldType === 'SingleCheckbox') return bool(value)
  return value ? choice('Yes', ['True']) : choice('No', ['False'])
}

const namePartConfidence = (full: string | null, part: string): 'exact' | 'guess' => {
  if (!full || !part) return 'guess'
  const parts = full.trim().split(/\s+/)
  return parts.length >= 2 ? 'exact' : 'guess'
}

const fullNameConfidence = (full: string | null): 'exact' | 'guess' => {
  if (!full) return 'guess'
  return full.trim().length > 0 ? 'exact' : 'guess'
}

const dateToValue = (parsed: ParsedDate | null, fieldType: string): ProfileValue => {
  if (!parsed) return { kind: 'unsupported' }
  if (TEXT_FIELD_TYPES.has(fieldType)) {
    if (parsed.month && parsed.day) {
      return str(`${parsed.year}-${parsed.month}-${parsed.day}`)
    }
    if (parsed.month) return str(`${parsed.year}-${parsed.month}`)
    return str(parsed.year)
  }
  return {
    kind: 'date',
    year: parsed.year,
    month: parsed.month ?? undefined,
    day: parsed.day ?? undefined,
  }
}

const isCurrentEntry = (
  entry: ProfileEducationEntry | ProfileExperienceEntry,
): boolean => {
  if (entry.isCurrent !== null) return entry.isCurrent
  return entry.endDate === null || entry.endDate === ''
}

const getEducationEntry = (
  profile: Profile,
  section: ParsedSection,
): ProfileEducationEntry | null => {
  const list = profile.education
  if (!list || list.length === 0) return null
  if (section.index === null) return list[0]
  return list[section.index] ?? null
}

const getExperienceEntry = (
  profile: Profile,
  section: ParsedSection,
): ProfileExperienceEntry | null => {
  const list = profile.experience
  if (!list || list.length === 0) return null
  if (section.index === null) return list[0]
  return list[section.index] ?? null
}

const labelShaped = (pattern: string): RegExp =>
  new RegExp(`^\\s*(?:${pattern})\\s*$|^\\s*(?:${pattern})[\\s:?]`, 'i')

const re = {
  firstName: /\b(first|given)\s*name\b/i,
  middleName: /\bmiddle\s*name\b/i,
  lastName: /\b(last|family|sur)\s*name\b/i,
  fullName: /\b(full|legal|applicant|your)\s*name\b|^\s*name\s*$/i,
  preferredName: /\b(preferred|nickname|alias)\b/i,
  email: /\bemail\b/i,
  phone: /\b(phone|mobile|cell|telephone|tel)\b/i,
  phoneExclusions: /\b(code|country|prefix|dialing|extension)\b/i,
  linkedin: /linked\s*in/i,
  github: /\bgithub\b/i,
  website: /\b(website|portfolio|personal\s*site|homepage)\b/i,
  jobTitleStrict: /\b(job|current|work|present)\s*title\b/i,
  yearsExperience: /\byears?\s*(of\s*)?experience\b/i,
  country: /\b(country|nationality)\b/i,
  nationality: /\bnationality\b/i,
  city: /\b(city|town)\b/i,
  region: /\b(state|province|region)\b/i,
  postalCode: /\b(zip|postal)\s*code\b/i,
  location: /\b(location|where.*based|current.*residence|address)\b/i,
  locationExclusions: /\b(code|prefix|dialing|line\s*\d|street|apt|apartment|suite)\b/i,
  relocate: /\brelocat(e|ion)\b/i,
  availability: /\b(availab(le|ility)|open\s*to\s*work)\b/i,
  availabilityExclusions: /\b(date|start|when|day|month|year|time)\b/i,
  summaryProfile: /\b(summary|bio|about\s*you|about\s*me|about\s*yourself|cover\s*letter|tell\s*us\s*about|self[\s-]*description)\b/i,
  hourlyRate: /\bhourly\s*rate\b/i,
  monthlyRate: /\bmonthly\s*rate\b/i,
  currency: /\b(currency|preferred\s*currency)\b/i,
  skills: /\b(skills?|technologies|tech\s*stack|expertise)\b/i,
  languages: /\b(languages?|spoken\s*languages?)\b/i,
  school: /\b(school|university|college|institution)\b/i,
  degree: /\b(degree|qualification)\b/i,
  fieldOfStudy: /\b(field\s*of\s*study|major|discipline|concentration)\b/i,
  gpa: /\bgpa\b/i,
  company: /\b(company|employer|organization|organisation)\b/i,
  workTitle: labelShaped('title|work\\s*title|position|role|job\\s*title|position\\s*title|role\\s*title'),
  employmentType: /\bemployment\s*type\b/i,
  workDescription: /\b(responsibilit(y|ies)|achievement|description)\b/i,
  startDate: /\bstart(\s*date)?\b/i,
  endDate: /\b(end|completion|graduation)(\s*date)?\b/i,
  currentlyHere: /\b(currently\s+(work|working|employed|enrolled|attend(ing)?|stud(y|ying)))\b|\b(current\s+(employer|position|role|school|university|college))\b|\b(present\s+(role|position|employer|school|university|college))\b/i,
}

const isPhoneField = (n: string): boolean =>
  re.phone.test(n) && !re.phoneExclusions.test(n)

const isLocationField = (n: string): boolean =>
  re.location.test(n) && !re.locationExclusions.test(n)

const isCountryField = (n: string): boolean =>
  re.country.test(n) && !re.locationExclusions.test(n)

const isNationalityField = (n: string): boolean =>
  re.nationality.test(n)

const countryToValue = (
  parsed: ParsedLocation | null,
  fieldType: string,
): ProfileValue => {
  if (!parsed?.country) return { kind: 'unsupported' }
  const { englishName, variants, alpha2, alpha3 } = parsed.country
  if (TEXT_FIELD_TYPES.has(fieldType)) return str(englishName)
  const fallbacks = variants.filter((v) => v !== englishName)
  if (!fallbacks.includes(alpha2)) fallbacks.push(alpha2)
  if (!fallbacks.includes(alpha3)) fallbacks.push(alpha3)
  return choice(englishName, fallbacks)
}

const cityFromParsed = (parsed: ParsedLocation | null): string | null => {
  if (!parsed) return null
  if (parsed.city) return parsed.city
  if (!parsed.country && parsed.remainder) return parsed.remainder
  return null
}

const cityToValue = (
  parsed: ParsedLocation | null,
  fieldType: string,
): ProfileValue => {
  const city = cityFromParsed(parsed)
  if (!city) return { kind: 'unsupported' }
  if (TEXT_FIELD_TYPES.has(fieldType)) return str(city)
  return choice(city, [])
}

const regionToValue = (
  parsed: ParsedLocation | null,
  fieldType: string,
): ProfileValue => {
  if (!parsed?.region) return { kind: 'unsupported' }
  if (TEXT_FIELD_TYPES.has(fieldType)) return str(parsed.region)
  return choice(parsed.region, [])
}

const rawLocationToValue = (
  profile: Profile,
  fieldType: string,
): ProfileValue => {
  const raw = profile.location ?? ''
  if (!raw) return { kind: 'unsupported' }
  if (TEXT_FIELD_TYPES.has(fieldType)) return str(raw)
  const parsed = parseLocation(raw)
  if (!parsed?.country) return { kind: 'unsupported' }
  return countryToValue(parsed, fieldType)
}

const resolveCountryGeneric = (
  profile: Profile,
  fieldType: string,
): ProfileValue => {
  const raw = profile.location ?? ''
  if (!raw) return { kind: 'unsupported' }
  const parsed = parseLocation(raw)
  if (parsed?.country) return countryToValue(parsed, fieldType)
  return { kind: 'unsupported' }
}

const resolveCityGeneric = (
  profile: Profile,
  fieldType: string,
): ProfileValue => cityToValue(parseLocation(profile.location), fieldType)

const resolveRegionGeneric = (
  profile: Profile,
  fieldType: string,
): ProfileValue => regionToValue(parseLocation(profile.location), fieldType)

const resolveEntryLocationField = (
  fieldName: string,
  fieldType: string,
  entry: ProfileEducationEntry | ProfileExperienceEntry,
  entryKind: 'education' | 'experience',
): ResolveResult | null => {
  const raw = entry.location ?? ''
  if (!raw) return null
  const parsed = parseLocation(raw)

  if (isCountryField(fieldName)) {
    return withField(countryToValue(parsed, fieldType), `${entryKind}.location`)
  }
  if (re.city.test(fieldName)) {
    return withField(cityToValue(parsed, fieldType), `${entryKind}.location`)
  }
  if (re.region.test(fieldName)) {
    return withField(regionToValue(parsed, fieldType), `${entryKind}.location`)
  }
  if (isLocationField(fieldName)) {
    if (TEXT_FIELD_TYPES.has(fieldType)) {
      return withField(str(raw), `${entryKind}.location`)
    }
    if (parsed?.country) {
      return withField(
        choice(parsed.country.englishName, parsed.country.variants.slice(1)),
        `${entryKind}.location`,
      )
    }
    return withField({ kind: 'unsupported' }, null)
  }
  return null
}

const skillsOrLanguagesValue = (
  names: string[],
  fieldType: string,
): ProfileValue => {
  if (names.length === 0) return { kind: 'unsupported' }
  if (TEXT_FIELD_TYPES.has(fieldType)) {
    return str(names.join(', '))
  }
  if (fieldType === 'SimpleDropdown') return choice(names[0], names.slice(1))
  return multiChoice(names, [])
}

const resolveGeneric = (
  fieldName: string,
  fieldType: string,
  profile: Profile,
): ResolveResult | null => {
  if (re.firstName.test(fieldName)) {
    const first = splitName(profile.profileName).first
    return withField(str(first, namePartConfidence(profile.profileName, first)), 'profileName')
  }
  if (re.middleName.test(fieldName)) {
    return withField(str(middleName(profile.profileName), 'guess'), 'profileName')
  }
  if (re.lastName.test(fieldName)) {
    const last = splitName(profile.profileName).last
    return withField(str(last, namePartConfidence(profile.profileName, last)), 'profileName')
  }
  if (re.fullName.test(fieldName)) {
    return withField(
      str(profile.profileName ?? '', fullNameConfidence(profile.profileName)),
      'profileName',
    )
  }
  if (re.preferredName.test(fieldName)) {
    return withField(str(splitName(profile.profileName).first, 'guess'), 'profileName')
  }
  if (re.email.test(fieldName)) {
    return withField(str(profile.user?.email ?? ''), 'user.email')
  }
  if (isPhoneField(fieldName)) {
    return withField(str(profile.user?.phoneNumber ?? ''), 'user.phoneNumber')
  }
  if (re.linkedin.test(fieldName)) {
    return withField(str(findLink(profile.links, 'linkedin')), 'links.linkedin')
  }
  if (re.github.test(fieldName)) {
    return withField(str(findLink(profile.links, 'github')), 'links.github')
  }
  if (re.website.test(fieldName)) {
    return withField(str(findLink(profile.links, 'other')), 'links.other')
  }
  if (re.jobTitleStrict.test(fieldName)) {
    return withField(str(profile.jobTitle ?? ''), 'jobTitle')
  }
  if (re.yearsExperience.test(fieldName)) {
    return withField(str(profile.totalExperience ?? ''), 'totalExperience')
  }
  if (re.hourlyRate.test(fieldName)) {
    return withField(str(profile.hourlyRate ?? ''), 'hourlyRate')
  }
  if (re.monthlyRate.test(fieldName)) {
    return withField(str(profile.monthlyRate ?? ''), 'monthlyRate')
  }
  if (re.currency.test(fieldName)) {
    const value = profile.rateCurrency ?? ''
    if (!value) return withField({ kind: 'unsupported' }, null)
    if (TEXT_FIELD_TYPES.has(fieldType)) return withField(str(value), 'rateCurrency')
    return withField(choice(value, []), 'rateCurrency')
  }
  if (isNationalityField(fieldName)) {
    return withField({ kind: 'unsupported' }, null)
  }
  if (isCountryField(fieldName)) {
    return withField(resolveCountryGeneric(profile, fieldType), 'location')
  }
  if (re.city.test(fieldName)) {
    return withField(resolveCityGeneric(profile, fieldType), 'location')
  }
  if (re.region.test(fieldName)) {
    return withField(resolveRegionGeneric(profile, fieldType), 'location')
  }
  if (isLocationField(fieldName)) {
    return withField(rawLocationToValue(profile, fieldType), 'location')
  }
  if (re.relocate.test(fieldName)) {
    if (profile.isInterestedInRelocation === null) {
      return withField({ kind: 'unsupported' }, null)
    }
    return withField(
      yesNoValue(profile.isInterestedInRelocation, fieldType),
      'isInterestedInRelocation',
    )
  }
  if (re.availability.test(fieldName) && !re.availabilityExclusions.test(fieldName)) {
    if (profile.isAvailableForHire === null) {
      return withField({ kind: 'unsupported' }, null)
    }
    return withField(yesNoValue(profile.isAvailableForHire, fieldType), 'isAvailableForHire')
  }
  if (re.summaryProfile.test(fieldName)) {
    return withField(str(profile.description ?? ''), 'description')
  }
  if (re.skills.test(fieldName)) {
    const skills = profile.skills ?? []
    if (skills.length === 0) return withField({ kind: 'unsupported' }, null)
    const sorted = [...skills].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))
    const names = sorted.map((s) => s.skill).filter(Boolean)
    return withField(skillsOrLanguagesValue(names, fieldType), 'skills')
  }
  if (re.languages.test(fieldName)) {
    const languages = profile.languages ?? []
    if (languages.length === 0) return withField({ kind: 'unsupported' }, null)
    const sorted = [...languages].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))
    const names = sorted.map((l) => l.language).filter(Boolean)
    return withField(skillsOrLanguagesValue(names, fieldType), 'languages')
  }
  return null
}

const resolveEducation = (
  fieldName: string,
  fieldType: string,
  entry: ProfileEducationEntry,
): ResolveResult | null => {
  if (re.school.test(fieldName)) {
    return entry.school
      ? withField(str(entry.school), 'education.school')
      : withField({ kind: 'unsupported' }, null)
  }
  if (re.degree.test(fieldName)) {
    if (!entry.degree) return withField({ kind: 'unsupported' }, null)
    return withField(
      TEXT_FIELD_TYPES.has(fieldType) ? str(entry.degree) : choice(entry.degree, []),
      'education.degree',
    )
  }
  if (re.fieldOfStudy.test(fieldName)) {
    if (!entry.fieldOfStudy) return withField({ kind: 'unsupported' }, null)
    return withField(
      TEXT_FIELD_TYPES.has(fieldType)
        ? str(entry.fieldOfStudy)
        : choice(entry.fieldOfStudy, []),
      'education.fieldOfStudy',
    )
  }
  if (re.gpa.test(fieldName)) {
    return entry.gpa
      ? withField(str(entry.gpa), 'education.gpa')
      : withField({ kind: 'unsupported' }, null)
  }
  if (re.currentlyHere.test(fieldName)) {
    return withField(yesNoValue(isCurrentEntry(entry), fieldType), 'education.isCurrent')
  }
  if (re.startDate.test(fieldName)) {
    return withField(dateToValue(parseDate(entry.startDate), fieldType), 'education.startDate')
  }
  if (re.endDate.test(fieldName)) {
    if (isCurrentEntry(entry)) return withField({ kind: 'unsupported' }, null)
    return withField(dateToValue(parseDate(entry.endDate), fieldType), 'education.endDate')
  }
  const entryLocation = resolveEntryLocationField(fieldName, fieldType, entry, 'education')
  if (entryLocation) return entryLocation
  if (re.workDescription.test(fieldName) && entry.description) {
    return withField(str(entry.description), 'education.description')
  }
  return null
}

const resolveExperience = (
  fieldName: string,
  fieldType: string,
  entry: ProfileExperienceEntry,
): ResolveResult | null => {
  if (re.company.test(fieldName)) {
    return entry.company
      ? withField(str(entry.company), 'experience.company')
      : withField({ kind: 'unsupported' }, null)
  }
  if (re.workTitle.test(fieldName) || re.jobTitleStrict.test(fieldName)) {
    return entry.title
      ? withField(str(entry.title), 'experience.title')
      : withField({ kind: 'unsupported' }, null)
  }
  if (re.employmentType.test(fieldName)) {
    if (!entry.employmentType) return withField({ kind: 'unsupported' }, null)
    return withField(
      TEXT_FIELD_TYPES.has(fieldType)
        ? str(entry.employmentType)
        : choice(entry.employmentType, []),
      'experience.employmentType',
    )
  }
  if (re.currentlyHere.test(fieldName)) {
    return withField(yesNoValue(isCurrentEntry(entry), fieldType), 'experience.isCurrent')
  }
  if (re.startDate.test(fieldName)) {
    return withField(dateToValue(parseDate(entry.startDate), fieldType), 'experience.startDate')
  }
  if (re.endDate.test(fieldName)) {
    if (isCurrentEntry(entry)) return withField({ kind: 'unsupported' }, null)
    return withField(dateToValue(parseDate(entry.endDate), fieldType), 'experience.endDate')
  }
  const entryLocation = resolveEntryLocationField(fieldName, fieldType, entry, 'experience')
  if (entryLocation) return entryLocation
  if (re.workDescription.test(fieldName) && entry.description) {
    return withField(str(entry.description), 'experience.description')
  }
  return null
}

const finalizeResult = (result: ResolveResult): ResolveResult => {
  if (result.value.kind === 'string' && !result.value.value) {
    return { value: { kind: 'unsupported' }, profileField: null }
  }
  return result
}

export const resolveField = (
  fieldName: string,
  fieldType: string,
  section: string,
  profile: Profile,
): ResolveResult => {
  const trimmed = (fieldName ?? '').trim()
  if (!trimmed) return unsupported()

  const parsedSection = parseSection(section)

  if (parsedSection.type === 'education') {
    const entry = getEducationEntry(profile, parsedSection)
    if (!entry) return unsupported()
    const eduResult = resolveEducation(trimmed, fieldType, entry)
    if (!eduResult) return unsupported()
    return finalizeResult(eduResult)
  }

  if (parsedSection.type === 'employment') {
    const entry = getExperienceEntry(profile, parsedSection)
    if (!entry) return unsupported()
    const expResult = resolveExperience(trimmed, fieldType, entry)
    if (!expResult) return unsupported()
    return finalizeResult(expResult)
  }

  const generic = resolveGeneric(trimmed, fieldType, profile)
  if (generic) return finalizeResult(generic)

  return unsupported()
}

export const profileValueIsResolved = (v: ProfileValue): boolean =>
  v.kind !== 'unsupported' && v.kind !== 'timeout'
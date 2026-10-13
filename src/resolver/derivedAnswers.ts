import type { Profile, ProfileExperienceEntry } from '~/api/types'
import type { ProfileValue } from '~/field/types'
import { parseDate } from './parseDate'
import { parseLocation } from './parseLocation'

export type ResolveContext = { now: Date }

export const defaultResolveContext = (): ResolveContext => ({ now: new Date() })

export type DerivedAnswer = { value: ProfileValue; profileField: string }

const TEXT_FIELD_TYPES = new Set(['TextInput', 'ContentEditable'])
const CHOICE_FIELD_TYPES = new Set(['SimpleDropdown', 'RadioGroup'])
const MULTI_FIELD_TYPES = new Set(['MultiCheckbox', 'MultiSearchableDropdown'])

const REFERRAL_SOURCE = /\b(how|where) did you (first )?(hear|learn|find out|find|see|come across)\b/i
const REFERRAL_NAME = 'TalentProfile'
const REFERRAL_FALLBACKS = ['TalentProfile.net', 'Talent Profile', 'Job board', 'Job Board', 'Job boards', 'Online job board']

const AGE_THRESHOLD =
  /\b(?:at least|over(?: the age of)?|aged)\s+(\d{2})\b|\b(\d{2})\s*(?:\+|years?(?: of age| old)?\s*(?:or (?:older|over|above)|\+))/i
const AGE_WORDING = /\b(age|aged|old|older)\b/i
const AGE_NEGATION = /\b(under|younger|less than|below)\b/i
const AGE_COMPOUND = /\b(and|also|willing|able|authori[sz]ed|eligible|legally|permit|licen[cs]e)\b/i
const EXPERIENCE_WORDING = /\bexperience\b/i
const MIN_AGE_AT_FIRST_ENTRY = 14

const COMPENSATION = /\b(salary|compensation|pay|remuneration|wages?|rate)\b/i
const DESIRED = /\b(desired|expected|expectations?|target|requested|asking)\b/i
const CURRENT = /\b(current|present|previous|last)\b/i
const HOURLY = /\b(hour|hourly)\b|\/\s*h(ou)?r\b/i
const MONTHLY = /\b(month|monthly)\b/i
const CURRENCY_CODE = /\b(USD|EUR|GBP|CAD|AUD|NZD|CHF|SEK|NOK|DKK|PLN|JPY|SGD|HKD|INR|THB|AED|ILS|ZAR|BRL|MXN)\b/i
const CURRENCY_SYMBOLS: Array<[RegExp, string]> = [
  [/£/, 'GBP'],
  [/€/, 'EUR'],
  [/\$/, 'USD'],
]

const RECENT_EMPLOYER = /\b(most recent|current|latest|last|present)\s+(employer|company)\b/i
const EMPLOYER_DETAIL = /\b(address|phone|e-?mail|contact|manager|supervisor|reference|date|start|end|reason|why|leav\w*|salary|title|position|role|city|country|location|size|industry)\b/i

const yesValue = (fieldType: string): ProfileValue | null => {
  if (fieldType === 'SingleCheckbox') return { kind: 'boolean', value: true }
  if (CHOICE_FIELD_TYPES.has(fieldType)) return { kind: 'choice', preferred: 'Yes', fallbacks: ['True'] }
  return null
}

export const isReferralSourceQuestion = (question: string): boolean => REFERRAL_SOURCE.test(question)

export const referralSourceAnswer = (fieldType: string): DerivedAnswer | null => {
  if (TEXT_FIELD_TYPES.has(fieldType)) {
    return { profileField: 'applicationSource', value: { confidence: 'exact', kind: 'string', value: REFERRAL_NAME } }
  }
  if (CHOICE_FIELD_TYPES.has(fieldType)) {
    return { profileField: 'applicationSource', value: { fallbacks: REFERRAL_FALLBACKS, kind: 'choice', preferred: REFERRAL_NAME } }
  }
  if (MULTI_FIELD_TYPES.has(fieldType)) {
    return { profileField: 'applicationSource', value: { fallbacks: REFERRAL_FALLBACKS, kind: 'multiChoice', preferred: [REFERRAL_NAME] } }
  }
  return null
}

export const askedMinimumAge = (question: string): number | null => {
  if (!AGE_WORDING.test(question) || AGE_NEGATION.test(question) || AGE_COMPOUND.test(question) || EXPERIENCE_WORDING.test(question)) return null
  const match = AGE_THRESHOLD.exec(question)
  if (!match) return null
  return Number(match[1] ?? match[2])
}

const completedYearsSince = (date: string | null, now: Date): number | null => {
  const parsed = parseDate(date)
  if (!parsed) return null
  const year = Number(parsed.year)
  const month = parsed.month ? Number(parsed.month) : 12
  const years = now.getUTCFullYear() - year - (now.getUTCMonth() + 1 < month ? 1 : 0)
  return Number.isFinite(years) && years >= 0 ? years : null
}

export const provenMinimumAge = (profile: Profile, now: Date): number | null => {
  const starts = [...(profile.education ?? []), ...(profile.experience ?? [])]
    .map((entry) => completedYearsSince(entry.startDate, now))
    .filter((years): years is number => years !== null)
  return starts.length === 0 ? null : Math.max(...starts) + MIN_AGE_AT_FIRST_ENTRY
}

export const minimumAgeAnswer = (question: string, fieldType: string, profile: Profile, context: ResolveContext): DerivedAnswer | null => {
  const asked = askedMinimumAge(question)
  if (asked === null) return null
  const proven = provenMinimumAge(profile, context.now)
  if (proven === null || proven < asked) return null
  const value = yesValue(fieldType)
  return value ? { profileField: 'experience.startDate', value } : null
}

export const isDesiredCompensationQuestion = (question: string): boolean =>
  COMPENSATION.test(question) && DESIRED.test(question) && !CURRENT.test(question)

const askedCurrency = (question: string): string | null => {
  const code = CURRENCY_CODE.exec(question)
  if (code) return code[1].toUpperCase()
  return CURRENCY_SYMBOLS.find(([symbol]) => symbol.test(question))?.[1] ?? null
}

const amountOf = (raw: string | null): number | null => {
  const amount = Number((raw ?? '').replace(/,/g, '').trim())
  return Number.isFinite(amount) && amount > 0 ? amount : null
}

export const desiredCompensationAnswer = (question: string, fieldType: string, profile: Profile): DerivedAnswer | null => {
  if (!TEXT_FIELD_TYPES.has(fieldType)) return null
  const currency = profile.rateCurrency?.trim().toUpperCase()
  if (!currency) return null
  const asked = askedCurrency(question)
  if (asked && asked !== currency) return null
  const hourly = amountOf(profile.hourlyRate)
  const monthly = amountOf(profile.monthlyRate)
  const [amount, profileField] = HOURLY.test(question)
    ? [hourly, 'hourlyRate']
    : MONTHLY.test(question)
      ? [monthly, 'monthlyRate']
      : [monthly === null ? null : monthly * 12, 'monthlyRate']
  if (amount === null) return null
  return { profileField, value: { confidence: 'exact', kind: 'string', value: String(Math.round(amount)) } }
}

export const isRecentEmployerQuestion = (question: string): boolean =>
  RECENT_EMPLOYER.test(question) && !EMPLOYER_DETAIL.test(question)

export const recentEmployerAnswer = (fieldType: string, profile: Profile): DerivedAnswer | null => {
  if (!TEXT_FIELD_TYPES.has(fieldType)) return null
  const company = latestExperience(profile, (entry) => entry.company)?.company?.trim()
  return company ? { profileField: 'experience.company', value: { confidence: 'exact', kind: 'string', value: company } } : null
}

export const latestExperience = (
  profile: Profile,
  pick: (entry: ProfileExperienceEntry) => string | null,
): ProfileExperienceEntry | null => {
  const named = (profile.experience ?? []).filter((entry) => pick(entry)?.trim())
  const current = named.filter((entry) => entry.isCurrent === true)
  return [...(current.length > 0 ? current : named)].sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''))[0] ?? null
}

export const inferredCity = (profile: Profile): string | null => {
  const home = parseLocation(profile.location)?.country?.alpha2
  if (!home) return null
  const job = parseLocation(latestExperience(profile, (entry) => entry.location)?.location)
  return job?.city && job.country?.alpha2 === home ? job.city : null
}

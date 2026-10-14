import type { Profile, ProfileExperienceEntry } from '~/api/types'
import type { ProfileValue } from '~/field/types'
import { parseDate } from './parseDate'

export type ResolveContext = { now: Date; referredByTalentProfile: boolean }

export const defaultResolveContext = (): ResolveContext => ({ now: new Date(), referredByTalentProfile: false })

export type DerivedAnswer = { value: ProfileValue; profileField: string }

const TEXT_FIELD_TYPES = new Set(['TextInput', 'ContentEditable'])
const CHOICE_FIELD_TYPES = new Set(['SimpleDropdown', 'RadioGroup'])
const MULTI_FIELD_TYPES = new Set(['MultiCheckbox', 'MultiSearchableDropdown'])
const DATE_FIELD_TYPES = new Set(['TextInput', 'MonthDayYear', 'MonthYear'])

const REFERRAL_SOURCE = /\b(how|where) did you (first )?(hear|learn|find out|find|see|come across)\b/i
const REFERRAL_NAME = 'TalentProfile'
const REFERRAL_FALLBACKS = ['TalentProfile.net', 'Talent Profile', 'Job board', 'Job Board', 'Job boards', 'Online job board']

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

const START_DATE =
  /\b(soonest|earliest|when)\b[^?]*\bstart\b|\b(desired|earliest|possible|available|availability|preferred)\s+start(ing)?\s+date\b|\bavailable (to|for) start\b|\bavailab(le|ility) (from|date)\b|\bwhen (are|would|will) you (be )?available\b/i
const NOTICE_PERIOD = /\bnotice period\b|\bhow much notice\b|\bperiod of notice\b/i
const DAY_MS = 24 * 60 * 60 * 1000

export const isReferralSourceQuestion = (question: string): boolean => REFERRAL_SOURCE.test(question)

export const referralSourceAnswer = (fieldType: string, context: ResolveContext): DerivedAnswer | null => {
  if (!context.referredByTalentProfile) return null
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

const latestExperience = (
  profile: Profile,
  pick: (entry: ProfileExperienceEntry) => string | null,
): ProfileExperienceEntry | null => {
  const named = (profile.experience ?? []).filter((entry) => pick(entry)?.trim())
  const current = named.filter((entry) => entry.isCurrent === true)
  return [...(current.length > 0 ? current : named)].sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''))[0] ?? null
}

export const isRecentEmployerQuestion = (question: string): boolean =>
  RECENT_EMPLOYER.test(question) && !EMPLOYER_DETAIL.test(question)

export const recentEmployerAnswer = (fieldType: string, profile: Profile): DerivedAnswer | null => {
  if (!TEXT_FIELD_TYPES.has(fieldType)) return null
  const company = latestExperience(profile, (entry) => entry.company)?.company?.trim()
  return company ? { profileField: 'experience.company', value: { confidence: 'exact', kind: 'string', value: company } } : null
}

const plural = (count: number, unit: string): string => `${count} ${unit}${count === 1 ? '' : 's'}`

const noticeWordings = (days: number): string[] => {
  if (days === 0) return ['Immediately', 'Immediate', 'Immediately available', 'None', '0 days']
  const wordings = [plural(days, 'day')]
  if (days % 30 === 0) wordings.unshift(plural(days / 30, 'month'))
  if (days % 7 === 0) wordings.unshift(plural(days / 7, 'week'))
  return wordings
}

const noticeDays = (profile: Profile): number | null => {
  const days = profile.noticePeriodDays
  return typeof days === 'number' && Number.isInteger(days) && days >= 0 ? days : null
}

export const isNoticePeriodQuestion = (question: string): boolean => NOTICE_PERIOD.test(question)

export const noticePeriodAnswer = (fieldType: string, profile: Profile): DerivedAnswer | null => {
  const days = noticeDays(profile)
  if (days === null) return null
  const [preferred, ...fallbacks] = noticeWordings(days)
  if (TEXT_FIELD_TYPES.has(fieldType)) return { profileField: 'noticePeriodDays', value: { confidence: 'exact', kind: 'string', value: preferred } }
  if (CHOICE_FIELD_TYPES.has(fieldType)) return { profileField: 'noticePeriodDays', value: { fallbacks, kind: 'choice', preferred } }
  return null
}

const isoDay = (date: Date): string => date.toISOString().slice(0, 10)

export const earliestStartDate = (profile: Profile, now: Date): string | null => {
  const today = isoDay(now)
  const from = parseDate(profile.availableFrom)
  if (from?.month && from.day) {
    const available = `${from.year}-${from.month}-${from.day}`
    return available > today ? available : today
  }
  const days = noticeDays(profile)
  return days === null ? null : isoDay(new Date(Date.parse(today) + days * DAY_MS))
}

export const isStartDateQuestion = (question: string): boolean => START_DATE.test(question) && !NOTICE_PERIOD.test(question)

export const startDateAnswer = (fieldType: string, profile: Profile, context: ResolveContext): DerivedAnswer | null => {
  if (!DATE_FIELD_TYPES.has(fieldType)) return CHOICE_FIELD_TYPES.has(fieldType) ? noticePeriodAnswer(fieldType, profile) : null
  const start = earliestStartDate(profile, context.now)
  if (!start) return null
  const [year, month, day] = start.split('-')
  return { profileField: profile.availableFrom ? 'availableFrom' : 'noticePeriodDays', value: { day, kind: 'date', month, year } }
}

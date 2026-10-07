import { isCountryScopedQuestion } from './countryScopedAnswers'
import { parseSection } from './sectionParser'

export const STANDARD_FIELDS = [
  'given-name',
  'family-name',
  'name',
  'email',
  'tel',
  'linkedin',
  'github',
  'organization-title',
  'address-level2',
  'address-level1',
  'country',
] as const

export type StandardField = (typeof STANDARD_FIELDS)[number]

const STANDARD_FIELD_SET: ReadonlySet<string> = new Set(STANDARD_FIELDS)

export const isStandardField = (value: unknown): value is StandardField =>
  typeof value === 'string' && STANDARD_FIELD_SET.has(value)

export type ControlKind = 'text' | 'select' | 'textarea' | 'choice' | 'other'

export type FieldEvidence = {
  control: ControlKind
  inputType: string
  autocomplete: string
  name: string
  id: string
  labels: string[]
  optionLabels: string[] | null
  section: string
}

const AUTOCOMPLETE: Record<string, StandardField> = {
  'address-level1': 'address-level1',
  'address-level2': 'address-level2',
  country: 'country',
  'country-name': 'country',
  email: 'email',
  'family-name': 'family-name',
  'given-name': 'given-name',
  name: 'name',
  'organization-title': 'organization-title',
  tel: 'tel',
  'tel-national': 'tel',
}

const NAME_OR_ID: Record<string, StandardField> = {
  city: 'address-level2',
  country: 'country',
  e_mail: 'email',
  email: 'email',
  email_address: 'email',
  emailaddress: 'email',
  family_name: 'family-name',
  familyname: 'family-name',
  first_name: 'given-name',
  firstname: 'given-name',
  full_name: 'name',
  fullname: 'name',
  github: 'github',
  github_url: 'github',
  given_name: 'given-name',
  givenname: 'given-name',
  last_name: 'family-name',
  lastname: 'family-name',
  linkedin: 'linkedin',
  linkedin_profile: 'linkedin',
  linkedin_url: 'linkedin',
  phone: 'tel',
  phone_number: 'tel',
  phonenumber: 'tel',
  surname: 'family-name',
  telephone: 'tel',
}

const LABEL: Record<string, StandardField> = {
  city: 'address-level2',
  country: 'country',
  email: 'email',
  'email address': 'email',
  'family name': 'family-name',
  'first name': 'given-name',
  'full name': 'name',
  github: 'github',
  'given name': 'given-name',
  'last name': 'family-name',
  linkedin: 'linkedin',
  'linkedin profile': 'linkedin',
  phone: 'tel',
  'phone number': 'tel',
  surname: 'family-name',
}

const INPUT_TYPE: Record<string, ReadonlySet<StandardField>> = {
  email: new Set(['email']),
  tel: new Set(['tel']),
  url: new Set(['linkedin', 'github']),
}

const TEXT_ONLY: ReadonlySet<StandardField> = new Set([
  'given-name',
  'family-name',
  'name',
  'email',
  'tel',
  'linkedin',
  'github',
  'organization-title',
])

const MIN_PLACE_OPTIONS = 3

const REFUSED_TOPICS =
  /\b(consent|agree|acknowledg\w*|terms|privacy|polic(y|ies)|gender|sex|sexual|race|racial|ethnic\w*|hispanic|latin[oax]|pronouns?|eeo|equal (employment )?opportunity|self[- ]identif\w*|disabilit(y|ies)|disabled|veterans?|military|criminal|convict\w*|felon\w*|offen[cs]es?|background check|arrest\w*|salary|compensation|wages?|pay|remuneration|availab\w*|notice period|start date|earliest start)\b/i

const THIRD_PARTY =
  /\b(referr(er|al|ed)|referee|reference|emergency|next of kin|manager|supervisor|recruiter|spouse|partner|parent|guardian|contact person|company|employer|school|university)\b/i

export const isRefusedQuestion = (text: string): boolean =>
  REFUSED_TOPICS.test(text) || isCountryScopedQuestion(text) || THIRD_PARTY.test(text)

const normalizeLabel = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[*✱:?]+/g, ' ')
    .replace(/\(\s*(required|optional)\s*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export const normalizeNameOrId = (value: string): string => {
  const lowered = value.trim().toLowerCase()
  const bracketed = /\[([^\]]+)\]$/.exec(lowered)
  return (bracketed ? bracketed[1] : lowered).replace(/[\s.-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
}

const fromAutocomplete = (value: string): StandardField | null | 'refused' => {
  const tokens = value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null
  if (tokens.length > 1) return 'refused'
  return AUTOCOMPLETE[tokens[0]] ?? null
}

const BOOLEAN_OPTION = /^(yes|no|true|false|y|n)$/i

const placeOptions = (options: string[] | null): boolean =>
  options !== null &&
  options.length >= MIN_PLACE_OPTIONS &&
  options.filter((option) => BOOLEAN_OPTION.test(option.trim())).length === 0

export type StandardFieldDecision =
  | { field: StandardField }
  | { refused: 'no-evidence' | 'qualified-autocomplete' | 'conflict' | 'sensitive' | 'control' | 'section' }

export const decideStandardField = (evidence: FieldEvidence): StandardFieldDecision => {
  if (parseSection(evidence.section).type !== 'other') return { refused: 'section' }
  const texts = [...evidence.labels, evidence.name, evidence.id]
  if (texts.some((text) => text && isRefusedQuestion(text.replace(/[_\-[\].]+/g, ' ')))) return { refused: 'sensitive' }
  const autocomplete = fromAutocomplete(evidence.autocomplete)
  if (autocomplete === 'refused') return { refused: 'qualified-autocomplete' }
  const strong = [autocomplete, NAME_OR_ID[normalizeNameOrId(evidence.name)] ?? null, NAME_OR_ID[normalizeNameOrId(evidence.id)] ?? null]
  const candidates = strong.filter((field): field is StandardField => field !== null)
  if (candidates.length === 0) return { refused: 'no-evidence' }
  const [field] = candidates
  const labelled = evidence.labels
    .map((text) => LABEL[normalizeLabel(text)] ?? null)
    .filter((value): value is StandardField => value !== null)
  if (candidates.some((value) => value !== field) || labelled.some((value) => value !== field)) return { refused: 'conflict' }
  const typed = INPUT_TYPE[evidence.inputType]
  if (typed && !typed.has(field)) return { refused: 'conflict' }
  if (evidence.control === 'choice' || evidence.control === 'other') return { refused: 'control' }
  if (evidence.control === 'textarea') return { refused: 'control' }
  if (evidence.control === 'select' && (TEXT_ONLY.has(field) || !placeOptions(evidence.optionLabels))) return { refused: 'control' }
  return { field }
}

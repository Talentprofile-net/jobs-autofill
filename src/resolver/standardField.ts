import { isAlternateIdentityQuestion } from './alternateIdentity'
import { isCountryScopedQuestion } from './countryScopedAnswers'
import { isNamePronunciationQuestion } from './namePronunciation'
import { combineNameWording, isOtherPersonQuestion, isScheduleTopic, isSensitiveTopic, isThirdPartyQuestion, withoutConditionalQualifiers } from './questionTopics'
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
  combobox: boolean
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

const WORDED_NAME_OR_ID: Record<string, StandardField> = {
  name: 'name',
}

const WORDING: ReadonlyArray<[StandardField, RegExp]> = [
  ['given-name', /\b(first|given) ?name\b/i],
  ['family-name', /\b(last|family) ?name\b|\bsurname\b/i],
  ['name', /\bfull ?name\b/i],
  ['email', /\be-?mail\b/i],
  ['tel', /\b(phone|mobile|telephone)\b/i],
  ['country', /\bcountry\b(?! code)/i],
  ['address-level2', /\bcity\b/i],
  ['linkedin', /\blinked ?in\b/i],
  ['github', /\bgit ?hub\b/i],
]

const wordedFields = (labels: string[]): ReadonlySet<StandardField> =>
  new Set(
    labels
      .map(combineNameWording)
      .flatMap((text) => WORDING.filter(([, pattern]) => pattern.test(text)).map(([field]) => field)),
  )

const SYSTEM_TOKEN: Record<string, StandardField> = {
  _systemfield_email: 'email',
  _systemfield_name: 'name',
}

const PATH_SEPARATOR = '--'

const PATH_SEGMENT = /^[a-z0-9_]+$/i

const APPLICANT_NAME_SCOPES: ReadonlySet<string> = new Set(['name', 'legalname', 'legal_name'])

const NAME_PARTS: ReadonlySet<StandardField> = new Set(['given-name', 'family-name'])

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

export const isRefusedQuestion = (text: string): boolean => {
  const asked = withoutConditionalQualifiers(text)
  return isSensitiveTopic(asked) || isScheduleTopic(asked) || isCountryScopedQuestion(asked) || isThirdPartyQuestion(asked)
}

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

const fromPath = (value: string): StandardField | null => {
  const segments = value.trim().split(PATH_SEPARATOR)
  if (segments.length < 2 || !segments.every((segment) => PATH_SEGMENT.test(segment))) return null
  const field = NAME_OR_ID[normalizeNameOrId(segments[segments.length - 1])] ?? null
  if (!field || !NAME_PARTS.has(field)) return null
  return segments.slice(0, -1).every((segment) => APPLICANT_NAME_SCOPES.has(normalizeNameOrId(segment))) ? field : null
}

const fromNameOrId = (value: string): StandardField | null =>
  SYSTEM_TOKEN[value.trim().toLowerCase()] ?? NAME_OR_ID[normalizeNameOrId(value)] ?? fromPath(value)

const fromWordedNameOrId = (evidence: FieldEvidence, worded: ReadonlySet<StandardField>): StandardField | null => {
  const [field] = [evidence.name, evidence.id].map((value) => WORDED_NAME_OR_ID[normalizeNameOrId(value)]).filter(Boolean)
  return field && worded.size === 1 && worded.has(field) ? field : null
}

const fromLabelAndType = (evidence: FieldEvidence, labelled: StandardField[]): StandardField | null => {
  const typed = INPUT_TYPE[evidence.inputType]
  if (!typed || labelled.length === 0 || labelled.length !== evidence.labels.length) return null
  const [field] = labelled
  if (labelled.some((value) => value !== field) || !typed.has(field)) return null
  return isRefusedQuestion(evidence.section) ? null : field
}

const EXACT_LABEL_TEXT_TYPES: ReadonlySet<string> = new Set(['', 'text'])

type ExactLabel = { field: StandardField; combobox: boolean }

const EXACT_LABEL: Partial<Record<string, ExactLabel>> = {
  city: { combobox: false, field: 'address-level2' },
  'country of residence': { combobox: true, field: 'country' },
  'current city': { combobox: false, field: 'address-level2' },
  'current country of residence': { combobox: true, field: 'country' },
  'current title': { combobox: false, field: 'organization-title' },
  'current/most recent job title': { combobox: false, field: 'organization-title' },
  'legal first name': { combobox: false, field: 'given-name' },
  'legal last name': { combobox: false, field: 'family-name' },
  'what country are you based in': { combobox: true, field: 'country' },
  'what country do you currently live in': { combobox: true, field: 'country' },
  'what is your current country of residence': { combobox: true, field: 'country' },
  'where do you live (city)': { combobox: false, field: 'address-level2' },
}

const exactLabel = (text: string): ExactLabel | null => EXACT_LABEL[normalizeLabel(text)] ?? null

const fromExactLabel = (evidence: FieldEvidence): StandardField | null => {
  if (evidence.control !== 'text' || !EXACT_LABEL_TEXT_TYPES.has(evidence.inputType) || evidence.labels.length === 0) return null
  const rules = evidence.labels.map(exactLabel)
  const [rule] = rules
  if (!rule || rules.some((value) => value?.field !== rule.field) || isRefusedQuestion(evidence.section)) return null
  return evidence.combobox && !rule.combobox ? null : rule.field
}

const LINK_PROVIDERS: ReadonlyArray<[StandardField, RegExp]> = [
  ['linkedin', /\blinked ?in\b/i],
  ['github', /\bgit ?hub\b/i],
]

const LINK_REQUEST = /\b(url|link|profile)\b/i

const SEVERAL_LINKS = /\b(urls|links|profiles)\b/i

const MAX_LINK_QUESTION = 120

const LINK_TEXT_TYPES: ReadonlySet<string> = new Set(['', 'text', 'url'])

const linkQuestionField = (text: string): StandardField | null => {
  const flat = text.replace(/\s+/g, ' ')
  if (flat.length > MAX_LINK_QUESTION || !LINK_REQUEST.test(flat) || SEVERAL_LINKS.test(flat) || isOtherPersonQuestion(flat)) return null
  const found = LINK_PROVIDERS.filter(([, pattern]) => pattern.test(flat))
  return found.length === 1 ? found[0][0] : null
}

const fromLinkQuestion = (evidence: FieldEvidence): StandardField | null => {
  if (evidence.combobox || evidence.labels.length === 0 || isRefusedQuestion(evidence.section)) return null
  if (evidence.control === 'text' ? !LINK_TEXT_TYPES.has(evidence.inputType) : evidence.control !== 'textarea') return null
  const fields = evidence.labels.map(linkQuestionField)
  const [field] = fields
  return field && fields.every((value) => value === field) ? field : null
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
  | {
      refused:
        | 'no-evidence'
        | 'qualified-autocomplete'
        | 'conflict'
        | 'sensitive'
        | 'alternate-identity'
        | 'name-pronunciation'
        | 'control'
        | 'section'
    }

export const decideStandardField = (evidence: FieldEvidence): StandardFieldDecision => {
  if (parseSection(evidence.section).type !== 'other') return { refused: 'section' }
  if (evidence.labels.some(isAlternateIdentityQuestion)) return { refused: 'alternate-identity' }
  const texts = [...evidence.labels, evidence.name, evidence.id]
  if (texts.some(isNamePronunciationQuestion)) return { refused: 'name-pronunciation' }
  if (texts.some((text) => text && isRefusedQuestion(text.replace(/[_\-[\].]+/g, ' ')))) return { refused: 'sensitive' }
  const autocomplete = fromAutocomplete(evidence.autocomplete)
  if (autocomplete === 'refused') return { refused: 'qualified-autocomplete' }
  const strong = [autocomplete, fromNameOrId(evidence.name), fromNameOrId(evidence.id)]
  const candidates = strong.filter((field): field is StandardField => field !== null)
  const labelled = evidence.labels
    .map((text) => LABEL[normalizeLabel(text)] ?? exactLabel(text)?.field ?? null)
    .filter((value): value is StandardField => value !== null)
  const worded = wordedFields(evidence.labels)
  const linked = fromLinkQuestion(evidence)
  const field =
    candidates[0] ??
    fromLabelAndType(evidence, labelled) ??
    fromExactLabel(evidence) ??
    linked ??
    fromWordedNameOrId(evidence, worded)
  if (!field) return { refused: 'no-evidence' }
  if (candidates.some((value) => value !== field) || labelled.some((value) => value !== field)) return { refused: 'conflict' }
  if (worded.size > 0 && !worded.has(field)) return { refused: 'conflict' }
  const typed = INPUT_TYPE[evidence.inputType]
  if (typed && !typed.has(field)) return { refused: 'conflict' }
  if (evidence.control === 'choice' || evidence.control === 'other') return { refused: 'control' }
  if (evidence.combobox && field === 'address-level2') return { refused: 'control' }
  if (evidence.control === 'textarea' && field !== linked) return { refused: 'control' }
  if (evidence.control === 'select' && (TEXT_ONLY.has(field) || !placeOptions(evidence.optionLabels))) return { refused: 'control' }
  return { field }
}

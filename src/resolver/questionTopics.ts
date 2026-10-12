const COMBINED_NAME = /\b(first|given) ?(and|&|\/|\+) ?(last|family) ?name\b/gi

export const combineNameWording = (text: string): string => text.replace(COMBINED_NAME, 'full name')

export const flattenApostrophes = (text: string): string => text.replace(/[‘’ʼ]/g, "'")

const THIRD_PARTY =
  /\b(referr(er|al|ed)|referee|reference|emergency|next of kin|manager|supervisor|recruiter|spouse|partner|parent|guardian|contact person|company|employer|school|university)\b/i

const OTHER_PERSON =
  /\b((?!(what|that|it|here|there|let|who|where)'s\b)\w+'s|co-?founders?|colleagues?|friends?|teammates?|someone|another person|person who)\b/i

export const isOtherPersonQuestion = (text: string): boolean => OTHER_PERSON.test(flattenApostrophes(text))

export const isThirdPartyQuestion = (text: string): boolean => THIRD_PARTY.test(text) || isOtherPersonQuestion(text)

const CONDITIONAL_QUALIFIER = /\(?\b(if|when|where) (available|applicable|any|possible|relevant|you have one)\b\)?/gi

export const withoutConditionalQualifiers = (text: string): string => text.replace(CONDITIONAL_QUALIFIER, ' ')

const SENSITIVE_TOPICS =
  /\b(consent|agree|acknowledg\w*|terms|privacy|polic(y|ies)|gender|sex|sexual|race|racial|ethnic\w*|hispanic|latin[oax]|pronouns?|eeo|equal (employment )?opportunity|self[- ]identif\w*|disabilit(y|ies)|disabled|veterans?|military|criminal|convict\w*|felon\w*|offen[cs]es?|background check|arrest\w*|salary|compensation|wages?|pay|remuneration|passports?|birth\w*|demographic\w*)\b/i

const SCHEDULE_TOPICS = /\b(availab\w*|notice period|start date|earliest start)\b/i

export const isSensitiveTopic = (text: string): boolean => SENSITIVE_TOPICS.test(withoutConditionalQualifiers(text))

export const isScheduleTopic = (text: string): boolean => SCHEDULE_TOPICS.test(withoutConditionalQualifiers(text))

const THIRD_PARTY_SECTION = /\b(emergency|next of kin|references?|referees?|referr(er|al)s?)\b/i

const DEMOGRAPHIC_SECTION = /\b(demographic\w*|self[- ]identif\w*|eeo|equal (employment )?opportunity|diversity|voluntary disclosures?)\b/i

export const isRefusedSection = (section: string): boolean => THIRD_PARTY_SECTION.test(section) || DEMOGRAPHIC_SECTION.test(section)

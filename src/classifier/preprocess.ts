import {
  INPUT_TEMPLATE,
  WHITESPACE_CHARACTERS,
  type ClassifierInput,
} from '~/classifier/contract'

const WHITESPACE = new RegExp(`[${WHITESPACE_CHARACTERS}]+`, 'gu')
const EDGE_SPACE = /^ +| +$/g

export function collapseWhitespace(text: string): string {
  return text.normalize('NFC').replace(WHITESPACE, ' ').replace(EDGE_SPACE, '')
}

export function serializeInput(value: ClassifierInput): string {
  const fields: Record<string, string> = {
    fieldType: collapseWhitespace(value.fieldType),
    jobCountry: collapseWhitespace(value.jobCountry),
    questionText: collapseWhitespace(value.questionText),
  }
  return INPUT_TEMPLATE.replace(/\{(fieldType|jobCountry|questionText)\}/g, (_, key: string) => fields[key])
}

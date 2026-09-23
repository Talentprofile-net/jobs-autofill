import {
  INPUT_TEMPLATE,
  OPTION_SEPARATOR,
  QUESTION_OPTIONS_SEPARATOR,
  WHITESPACE_CHARACTERS,
  type ClassifierInput,
} from '~/classifier/contract'

const WHITESPACE = new RegExp(`[${WHITESPACE_CHARACTERS}]+`, 'gu')
const EDGE_SPACE = /^ +| +$/g

export function collapseWhitespace(text: string): string {
  return text.normalize('NFC').replace(WHITESPACE, ' ').replace(EDGE_SPACE, '')
}

export function questionWithOptions(questionText: string, optionLabels: string[]): string {
  const labels = optionLabels.map(collapseWhitespace).filter((label) => label.length > 0)
  const question = collapseWhitespace(questionText)
  return labels.length ? question + QUESTION_OPTIONS_SEPARATOR + labels.join(OPTION_SEPARATOR) : question
}

export function serializeInput(value: ClassifierInput): string {
  const fields: Record<string, string> = {
    fieldType: collapseWhitespace(value.fieldType),
    jobCountry: collapseWhitespace(value.jobCountry),
    questionText: questionWithOptions(value.questionText, value.optionLabels),
  }
  return INPUT_TEMPLATE.replace(/\{(fieldType|jobCountry|questionText)\}/g, (_, key: string) => fields[key])
}

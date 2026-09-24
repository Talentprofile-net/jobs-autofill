import {
  EMPTY_OPTIONS,
  INPUT_SERIALIZATION_VERSION,
  INPUT_TEMPLATE,
  MASKED_LOGIT,
  OPTION_SEPARATOR,
  POLICY_SCHEMA_VERSION,
  PREPROCESSING_SCHEMA_VERSION,
  QUESTION_OPTIONS_SEPARATOR,
  VOCABULARY_RULE_VERSION,
  WHITESPACE_CHARACTERS,
} from './contract'

export const RUNTIME_FILES = [
  'model.onnx',
  'tokenizer.json',
  'labels.json',
  'selective_policy.json',
  'preprocessing.json',
  'model-version.json',
] as const

export type RuntimeFile = (typeof RUNTIME_FILES)[number]

export const RUNTIME_CONTRACT = {
  emptyOptions: EMPTY_OPTIONS,
  inputSerializationVersion: INPUT_SERIALIZATION_VERSION,
  inputTemplate: INPUT_TEMPLATE,
  maskedLogit: MASKED_LOGIT,
  optionSeparator: OPTION_SEPARATOR,
  policySchemaVersion: POLICY_SCHEMA_VERSION,
  preprocessingSchemaVersion: PREPROCESSING_SCHEMA_VERSION,
  questionOptionsSeparator: QUESTION_OPTIONS_SEPARATOR,
  vocabularyRuleVersion: VOCABULARY_RULE_VERSION,
  whitespaceCharacters: WHITESPACE_CHARACTERS,
}

const hex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')

export const sha256Hex = async (data: BufferSource): Promise<string> =>
  hex(await crypto.subtle.digest('SHA-256', data))

export const runtimeIdentity = async (files: Record<RuntimeFile, ArrayBuffer>): Promise<string> => {
  const hashes: string[] = []
  for (const name of RUNTIME_FILES) hashes.push(await sha256Hex(files[name]))
  const canonical = JSON.stringify({
    contract: RUNTIME_CONTRACT,
    files: RUNTIME_FILES.map((name, index) => [name, hashes[index]]),
  })
  return sha256Hex(new TextEncoder().encode(canonical))
}

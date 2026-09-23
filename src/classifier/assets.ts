import { browser } from 'wxt/browser'

import {
  POLICY_SCHEMA_VERSION,
  PREPROCESSING_SCHEMA_VERSION,
  INPUT_SERIALIZATION_VERSION,
  INPUT_TEMPLATE,
  EMPTY_OPTIONS,
  OPTION_SEPARATOR,
  QUESTION_OPTIONS_SEPARATOR,
  VOCABULARY_RULE_VERSION,
  type LabelMap,
  type SelectivePolicy,
} from '~/classifier/contract'
import type { ClassifierAssets } from '~/classifier/session'

export const ASSET_DIR = 'classifier'

export type ExportVocabulary = {
  ruleVersion: string
  baseSize: number
  requestedSize: number
  keptSize: number
}

export type Preprocessing = {
  preprocessingSchemaVersion: string
  inputSerializationVersion: string
  template: string
  maxLength: number
  padTokenId: number
  paddingSide: 'left' | 'right'
  unicodeNormalization: string
  questionOptionsSeparator: string
  optionSeparator: string
  emptyOptions: string
  vocabulary: ExportVocabulary | null
}

export type ManifestSummary = {
  modelVersion: string
}

export function assetUrl(name: string): string {
  return new URL(`${ASSET_DIR}/${name}`, browser.runtime.getURL('/')).toString()
}

export function checkPreprocessing(preprocessing: Preprocessing): void {
  if (preprocessing.preprocessingSchemaVersion !== PREPROCESSING_SCHEMA_VERSION) {
    throw new Error(`unsupported preprocessing schema ${preprocessing.preprocessingSchemaVersion}`)
  }
  if (preprocessing.inputSerializationVersion !== INPUT_SERIALIZATION_VERSION) {
    throw new Error(`unsupported input serialization ${preprocessing.inputSerializationVersion}`)
  }
  if (preprocessing.template !== INPUT_TEMPLATE) throw new Error('artifact template does not match the runtime')
  if (preprocessing.paddingSide !== 'right') throw new Error('only right padding is supported')
  if (preprocessing.unicodeNormalization !== 'NFC') throw new Error('only NFC normalization is supported')
  if (
    preprocessing.questionOptionsSeparator !== QUESTION_OPTIONS_SEPARATOR ||
    preprocessing.optionSeparator !== OPTION_SEPARATOR ||
    preprocessing.emptyOptions !== EMPTY_OPTIONS
  ) {
    throw new Error('artifact option serialization does not match the runtime')
  }
  if (preprocessing.vocabulary === undefined) throw new Error('the artifact does not record its export vocabulary')
  if (preprocessing.vocabulary !== null && preprocessing.vocabulary.ruleVersion !== VOCABULARY_RULE_VERSION) {
    throw new Error(`unsupported export vocabulary rule ${preprocessing.vocabulary.ruleVersion}`)
  }
}

export function tokenizerVocabularySize(tokenizerJson: unknown): number {
  if (typeof tokenizerJson === 'object' && tokenizerJson !== null && 'model' in tokenizerJson) {
    const model = tokenizerJson.model
    if (typeof model === 'object' && model !== null && 'vocab' in model && Array.isArray(model.vocab)) {
      return model.vocab.length
    }
  }
  throw new Error('tokenizer.json has no vocabulary list')
}

export function checkVocabulary(preprocessing: Preprocessing, tokenizerJson: unknown): void {
  if (preprocessing.vocabulary === null) return
  const size = tokenizerVocabularySize(tokenizerJson)
  if (size !== preprocessing.vocabulary.keptSize) {
    throw new Error(`tokenizer has ${size} pieces but the artifact records ${preprocessing.vocabulary.keptSize}`)
  }
}

export function checkPolicy(policy: SelectivePolicy): void {
  if (policy.policySchemaVersion !== POLICY_SCHEMA_VERSION) {
    throw new Error(`unsupported policy schema ${policy.policySchemaVersion}`)
  }
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`cannot read ${url}: ${response.status}`)
  return (await response.json()) as T
}

export async function loadAssets(): Promise<{ assets: ClassifierAssets; model: ArrayBuffer }> {
  const [preprocessing, labelMap, policy, manifest, tokenizerJson] = await Promise.all([
    readJson<Preprocessing>(assetUrl('preprocessing.json')),
    readJson<LabelMap>(assetUrl('labels.json')),
    readJson<SelectivePolicy>(assetUrl('selective_policy.json')),
    readJson<ManifestSummary>(assetUrl('model-version.json')),
    readJson<unknown>(assetUrl('tokenizer.json')),
  ])
  checkPreprocessing(preprocessing)
  checkVocabulary(preprocessing, tokenizerJson)
  checkPolicy(policy)
  const response = await fetch(assetUrl('model.onnx'))
  if (!response.ok) throw new Error(`cannot read the model: ${response.status}`)
  return {
    model: await response.arrayBuffer(),
    assets: {
      tokenizerJson,
      labelMap,
      policy,
      maxLength: preprocessing.maxLength,
      padTokenId: preprocessing.padTokenId,
      modelVersion: manifest.modelVersion,
    },
  }
}

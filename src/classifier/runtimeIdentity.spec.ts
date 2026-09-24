import { describe, expect, it } from 'bun:test'

import { loadAssets } from './assets'
import { CLASSIFIER_BUILD_FILES } from './attestation'
import {
  EMPTY_OPTIONS,
  INPUT_SERIALIZATION_VERSION,
  INPUT_TEMPLATE,
  OPTION_SEPARATOR,
  POLICY_SCHEMA_VERSION,
  PREPROCESSING_SCHEMA_VERSION,
  QUESTION_OPTIONS_SEPARATOR,
} from './contract'
import { RUNTIME_FILES, runtimeIdentity, type RuntimeFile } from './runtimeIdentity'

const bytes = (value: unknown): ArrayBuffer =>
  new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).buffer

const staged = (): Record<RuntimeFile, ArrayBuffer> => ({
  'labels.json': bytes({ labelMapSchemaVersion: 'label-map.v1', labels: [] }),
  'model-version.json': bytes({ modelVersion: 'candidate-1' }),
  'model.onnx': new Uint8Array([1, 2, 3, 4]).buffer,
  'preprocessing.json': bytes({
    emptyOptions: EMPTY_OPTIONS,
    inputSerializationVersion: INPUT_SERIALIZATION_VERSION,
    maxLength: 128,
    optionSeparator: OPTION_SEPARATOR,
    padTokenId: 1,
    paddingSide: 'right',
    preprocessingSchemaVersion: PREPROCESSING_SCHEMA_VERSION,
    questionOptionsSeparator: QUESTION_OPTIONS_SEPARATOR,
    template: INPUT_TEMPLATE,
    unicodeNormalization: 'NFC',
    vocabulary: null,
  }),
  'selective_policy.json': bytes({ policySchemaVersion: POLICY_SCHEMA_VERSION }),
  'tokenizer.json': bytes({ model: { vocab: [] } }),
})

const changed = (files: Record<RuntimeFile, ArrayBuffer>, name: RuntimeFile) => {
  const copy = new Uint8Array(files[name].slice(0))
  copy[copy.length - 1] ^= 1
  return { ...files, [name]: copy.buffer }
}

describe('classifier runtime identity', () => {
  it('covers every classifier file the build ships', () => {
    expect([...RUNTIME_FILES].sort()).toEqual(
      CLASSIFIER_BUILD_FILES.map((path) => path.replace(/^classifier\//, '')).sort(),
    )
  })

  it('is stable for the same staged bytes', async () => {
    expect(await runtimeIdentity(staged())).toBe(await runtimeIdentity(staged()))
  })

  it.each([...RUNTIME_FILES])('changes when %s changes, even with the same modelVersion', async (name) => {
    expect(await runtimeIdentity(changed(staged(), name))).not.toBe(await runtimeIdentity(staged()))
  })

  it('is what the loader reports for the files it actually fetched', async () => {
    const files = staged()
    const fetched: string[] = []
    const loaded = await loadAssets(async (name) => {
      fetched.push(name)
      return files[name]
    })

    expect(fetched.sort()).toEqual([...RUNTIME_FILES].sort())
    expect(loaded.assets.modelVersion).toBe('candidate-1')
    expect(loaded.runtimeId).toBe(await runtimeIdentity(files))
  })

  it('never fetches the model when the staged contract is rejected', async () => {
    const files = { ...staged(), 'selective_policy.json': bytes({ policySchemaVersion: 'other' }) }
    const fetched: string[] = []

    const error = await loadAssets(async (name) => {
      fetched.push(name)
      return files[name]
    }).then(
      () => null,
      (failure: Error) => failure.message,
    )

    expect(error).toBe('unsupported policy schema other')
    expect(fetched).not.toContain('model.onnx')
  })
})

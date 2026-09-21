import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import fixture from '~/classifier/__fixtures__/parity.json'
import type { AnswerKind, Decision, LabelMap, SelectivePolicy } from '~/classifier/contract'
import type { Preprocessing } from '~/classifier/assets'
import { QuestionClassifier, type OrtLike } from '~/classifier/session'

type Case = {
  input: { questionText: string; fieldType: string; jobCountry: string }
  answerKind: AnswerKind
  text: string
  logits: number[]
  decision: Decision
}

const cases = fixture.cases as unknown as Case[]
const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/classifier')
const enabled = process.env.CLASSIFIER_MODEL_PARITY === '1' && existsSync(resolve(ASSETS, 'model.onnx'))
const readAsset = <T>(name: string): T => JSON.parse(readFileSync(resolve(ASSETS, name), 'utf8')) as T

describe('model parity', () => {
  it.skipIf(!enabled)(
    'matches python logits and decisions through onnxruntime-web',
    async () => {
      const ort = await import('onnxruntime-web/wasm')
      ort.env.wasm.numThreads = 1
      const preprocessing = readAsset<Preprocessing>('preprocessing.json')
      const classifier = await QuestionClassifier.create(
        ort as unknown as OrtLike,
        readFileSync(resolve(ASSETS, 'model.onnx')).buffer as ArrayBuffer,
        {
          tokenizerJson: readAsset('tokenizer.json'),
          labelMap: readAsset<LabelMap>('labels.json'),
          policy: readAsset<SelectivePolicy>('selective_policy.json'),
          maxLength: preprocessing.maxLength,
          padTokenId: preprocessing.padTokenId,
          modelVersion: fixture.modelVersion,
        },
      )
      const rows = await classifier.logits(cases.map((item) => item.text))
      const worst = rows.reduce(
        (largest, row, index) =>
          row.reduce((value, logit, column) => Math.max(value, Math.abs(logit - cases[index].logits[column])), largest),
        0,
      )
      expect(worst).toBeLessThan(1e-3)

      const decisions = await classifier.classify(
        cases.map((item) => ({ input: item.input, answerKind: item.answerKind })),
      )
      expect(decisions.map((decision) => decision.labelEnumId)).toEqual(
        cases.map((item) => item.decision.labelEnumId),
      )
      expect(decisions.map((decision) => decision.abstentionReason)).toEqual(
        cases.map((item) => item.decision.abstentionReason),
      )
    },
    600_000,
  )
})

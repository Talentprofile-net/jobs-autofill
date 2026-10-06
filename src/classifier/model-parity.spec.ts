import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import fixture from '~/classifier/__fixtures__/parity.json'
import type { AnswerKind, Decision, LabelMap, SelectivePolicy } from '~/classifier/contract'
import { ANSWER_LABEL_CHUNK } from '~/classifier/answerLabels'
import type { Preprocessing } from '~/classifier/assets'
import { QuestionClassifier, type OrtLike } from '~/classifier/session'

type Case = {
  input: { questionText: string; fieldType: string; jobCountry: string; optionLabels: string[] }
  answerKind: AnswerKind
  text: string
  logits: number[]
  decision: Decision
}

const cases = fixture.cases as unknown as Case[]
const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/classifier')
const requested = process.env.CLASSIFIER_MODEL_PARITY === '1'
const enabled = requested && existsSync(resolve(ASSETS, 'model.onnx'))
if (requested && !enabled) {
  throw new Error(`no staged model in ${ASSETS}; run scripts/stage-classifier-assets.mjs first`)
}
const readAsset = <T>(name: string): T => JSON.parse(readFileSync(resolve(ASSETS, name), 'utf8')) as T

let loaded: Promise<QuestionClassifier> | null = null
const loadClassifier = () => {
  loaded ??= (async () => {
    const ort = await import('onnxruntime-web/wasm')
    ort.env.wasm.numThreads = 1
    const preprocessing = readAsset<Preprocessing>('preprocessing.json')
    return QuestionClassifier.create(
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
  })()
  return loaded
}

const worstGap = (rows: number[][], expected: number[][]): number =>
  rows.reduce(
    (largest, row, index) =>
      row.reduce((value, logit, column) => Math.max(value, Math.abs(logit - expected[index][column])), largest),
    0,
  )

describe('model parity', () => {
  it.skipIf(!enabled)(
    'matches python logits and decisions through onnxruntime-web',
    async () => {
      const classifier = await loadClassifier()
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

  it.skipIf(!enabled)(
    'classifies stored-answer chunks the same as one whole batch',
    async () => {
      const classifier = await loadClassifier()
      const requests = cases.map((item) => ({ input: item.input, answerKind: item.answerKind }))
      const texts = cases.map((item) => item.text)
      const chunks = Array.from({ length: Math.ceil(cases.length / ANSWER_LABEL_CHUNK) }, (_, index) =>
        index * ANSWER_LABEL_CHUNK,
      )
      const whole = await classifier.logits(texts)
      const chunked: number[][] = []
      for (const start of chunks) chunked.push(...(await classifier.logits(texts.slice(start, start + ANSWER_LABEL_CHUNK))))
      expect(chunks.length).toBeGreaterThan(1)
      expect(worstGap(chunked, whole)).toBeLessThan(1e-3)
      expect(worstGap(chunked, cases.map((item) => item.logits))).toBeLessThan(1e-3)

      const wholeDecisions = await classifier.classify(requests)
      const chunkedDecisions: Decision[] = []
      for (const start of chunks) {
        chunkedDecisions.push(...(await classifier.classify(requests.slice(start, start + ANSWER_LABEL_CHUNK))))
      }
      expect(chunkedDecisions.map((decision) => decision.labelEnumId)).toEqual(
        wholeDecisions.map((decision) => decision.labelEnumId),
      )
      expect(chunkedDecisions.map((decision) => decision.abstentionReason)).toEqual(
        wholeDecisions.map((decision) => decision.abstentionReason),
      )
      expect(chunkedDecisions.map((decision) => decision.labelEnumId)).toEqual(
        cases.map((item) => item.decision.labelEnumId),
      )
      const confidenceGap = chunkedDecisions.reduce(
        (largest, decision, index) =>
          Math.max(largest, Math.abs(decision.calibratedConfidence - wholeDecisions[index].calibratedConfidence)),
        0,
      )
      expect(confidenceGap).toBeLessThan(1e-3)
    },
    600_000,
  )
})

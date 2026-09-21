import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import fixture from '~/classifier/__fixtures__/parity.json'
import type { AnswerKind, Decision, LabelMap, SelectivePolicy } from '~/classifier/contract'
import { checkPolicy, checkPreprocessing, type Preprocessing } from '~/classifier/assets'
import { decide } from '~/classifier/policy'
import { collapseWhitespace, serializeInput } from '~/classifier/preprocess'
import { encodeBatch, truncateIds, unknownQuestion } from '~/classifier/session'

type Case = {
  input: { questionText: string; fieldType: string; jobCountry: string }
  answerKind: AnswerKind
  note: string
  text: string
  tokenIds: number[]
  logits: number[]
  decision: Decision
}

const cases = fixture.cases as unknown as Case[]
const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/classifier')
const staged = existsSync(resolve(ASSETS, 'tokenizer.json'))
const readAsset = <T>(name: string): T => JSON.parse(readFileSync(resolve(ASSETS, name), 'utf8')) as T

describe('preprocessing parity', () => {
  it('serializes every fixture case exactly as python does', () => {
    for (const item of cases) {
      expect(serializeInput(item.input)).toBe(item.text)
    }
  })

  it('collapses the whitespace classes python collapses', () => {
    expect(collapseWhitespace('  a  b\t\nc  ')).toBe('a b c')
    expect(collapseWhitespace('　')).toBe('')
    expect(collapseWhitespace('é')).toBe('é')
  })

  it('treats a blank question as unknown', () => {
    expect(unknownQuestion('   ')).toBe(true)
    expect(unknownQuestion('First name')).toBe(false)
  })
})

describe('policy parity', () => {
  const labelMap = staged ? readAsset<LabelMap>('labels.json') : null
  const policy = staged ? readAsset<SelectivePolicy>('selective_policy.json') : null

  it.skipIf(!staged)('reaches the same decision as python for every fixture case', () => {
    for (const item of cases) {
      const decision = decide({
        logits: item.logits,
        policy: policy!,
        labelMap: labelMap!,
        context: {
          answerKind: item.answerKind,
          jobCountry: item.input.jobCountry,
          unknownQuestion: unknownQuestion(item.input.questionText),
        },
        modelVersion: fixture.modelVersion,
      })
      expect({ ...decision, calibratedConfidence: 0, margin: 0 }).toEqual({
        ...item.decision,
        calibratedConfidence: 0,
        margin: 0,
      })
      expect(decision.calibratedConfidence).toBeCloseTo(item.decision.calibratedConfidence, 6)
      expect(decision.margin).toBeCloseTo(item.decision.margin, 6)
    }
  })

  it.skipIf(!staged)('accepts the artifact preprocessing and policy contracts', () => {
    checkPreprocessing(readAsset<Preprocessing>('preprocessing.json'))
    checkPolicy(policy!)
  })
})

describe('tokenizer parity', () => {
  it.skipIf(!staged)('produces python token ids, including truncation', async () => {
    const { PreTrainedTokenizer } = await import('@huggingface/transformers')
    const tokenizer = new PreTrainedTokenizer(readAsset('tokenizer.json'), {})
    const preprocessing = readAsset<Preprocessing>('preprocessing.json')
    const batch = encodeBatch(
      tokenizer,
      cases.map((item) => item.text),
      preprocessing.maxLength,
      preprocessing.padTokenId,
    )
    const [rows, width] = batch.dims
    expect(rows).toBe(cases.length)
    for (let row = 0; row < rows; row += 1) {
      const ids: number[] = []
      for (let column = 0; column < width; column += 1) {
        if (batch.attentionMask[row * width + column] === 1n) {
          ids.push(Number(batch.inputIds[row * width + column]))
        }
      }
      expect(ids).toEqual(cases[row].tokenIds)
      expect(ids.length).toBeLessThanOrEqual(preprocessing.maxLength)
    }
  })

  it('pads to the batch width and keeps the first and last special tokens when truncating', () => {
    expect(truncateIds([0, 5, 6, 7, 2], [5, 6, 7], 4)).toEqual([0, 5, 6, 2])
    expect(truncateIds([0, 5, 2], [5], 8)).toEqual([0, 5, 2])
    expect(truncateIds([5, 6, 7], [5, 6, 7], 2)).toEqual([5, 6])
  })
})

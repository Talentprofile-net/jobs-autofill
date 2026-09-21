import { PreTrainedTokenizer } from '@huggingface/transformers'
import type { InferenceSession, Tensor as OrtTensor } from 'onnxruntime-common'

import {
  type AnswerKind,
  type ClassifierInput,
  type Decision,
  type LabelMap,
  type SelectivePolicy,
} from '~/classifier/contract'
import { decide } from '~/classifier/policy'
import { collapseWhitespace, serializeInput } from '~/classifier/preprocess'

export type ClassifierAssets = {
  tokenizerJson: unknown
  labelMap: LabelMap
  policy: SelectivePolicy
  maxLength: number
  padTokenId: number
  modelVersion: string
}

export type ClassifyRequest = {
  input: ClassifierInput
  answerKind: AnswerKind
}

export type OrtLike = {
  InferenceSession: {
    create(model: ArrayBuffer | Uint8Array, options?: InferenceSession.SessionOptions): Promise<InferenceSession>
  }
  Tensor: new (type: 'int64', data: BigInt64Array, dims: number[]) => OrtTensor
}

export type EncodedBatch = {
  inputIds: BigInt64Array
  attentionMask: BigInt64Array
  dims: [number, number]
}

export function prefixLength(withSpecials: number[], body: number[]): number {
  for (let offset = 0; offset + body.length <= withSpecials.length; offset += 1) {
    if (body.every((id, index) => withSpecials[offset + index] === id)) return offset
  }
  return 0
}

export function truncateIds(withSpecials: number[], body: number[], maxLength: number): number[] {
  if (withSpecials.length <= maxLength) return withSpecials
  const specials = withSpecials.length - body.length
  const prefix = prefixLength(withSpecials, body)
  const head = withSpecials.slice(0, prefix)
  const tail = withSpecials.slice(withSpecials.length - (specials - prefix))
  return [...head, ...body.slice(0, maxLength - specials), ...tail]
}

export function encodeBatch(
  tokenizer: PreTrainedTokenizer,
  texts: string[],
  maxLength: number,
  padTokenId: number,
): EncodedBatch {
  if (!texts.length) throw new Error('cannot encode an empty batch')
  const sequences = texts.map((text) =>
    truncateIds(tokenizer.encode(text), tokenizer.encode(text, { add_special_tokens: false }), maxLength),
  )
  const width = Math.max(...sequences.map((sequence) => sequence.length))
  const inputIds = new BigInt64Array(sequences.length * width).fill(BigInt(padTokenId))
  const attentionMask = new BigInt64Array(sequences.length * width)
  sequences.forEach((sequence, row) => {
    sequence.forEach((id, column) => {
      inputIds[row * width + column] = BigInt(id)
      attentionMask[row * width + column] = 1n
    })
  })
  return { inputIds, attentionMask, dims: [sequences.length, width] }
}

export function unknownQuestion(questionText: string): boolean {
  return collapseWhitespace(questionText).length === 0
}

export class QuestionClassifier {
  private constructor(
    private readonly session: InferenceSession,
    private readonly tokenizer: PreTrainedTokenizer,
    private readonly assets: ClassifierAssets,
    private readonly ort: OrtLike,
  ) {}

  static async create(ort: OrtLike, model: ArrayBuffer, assets: ClassifierAssets): Promise<QuestionClassifier> {
    const session = await ort.InferenceSession.create(model, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })
    const tokenizer = new PreTrainedTokenizer(assets.tokenizerJson, {})
    return new QuestionClassifier(session, tokenizer, assets, ort)
  }

  async logits(texts: string[]): Promise<number[][]> {
    const batch = encodeBatch(this.tokenizer, texts, this.assets.maxLength, this.assets.padTokenId)
    const output = await this.session.run({
      input_ids: new this.ort.Tensor('int64', batch.inputIds, batch.dims),
      attention_mask: new this.ort.Tensor('int64', batch.attentionMask, batch.dims),
    })
    const values = output.logits.data as Float32Array
    const width = this.assets.labelMap.labels.length
    return batch.dims[0] === 0
      ? []
      : Array.from({ length: batch.dims[0] }, (_, row) =>
          Array.from(values.slice(row * width, row * width + width), Number),
        )
  }

  async classify(requests: ClassifyRequest[]): Promise<Decision[]> {
    if (!requests.length) return []
    const rows = await this.logits(requests.map((request) => serializeInput(request.input)))
    return rows.map((logits, index) =>
      decide({
        logits,
        policy: this.assets.policy,
        labelMap: this.assets.labelMap,
        context: {
          answerKind: requests[index].answerKind,
          jobCountry: collapseWhitespace(requests[index].input.jobCountry),
          unknownQuestion: unknownQuestion(requests[index].input.questionText),
        },
        modelVersion: this.assets.modelVersion,
      }),
    )
  }
}

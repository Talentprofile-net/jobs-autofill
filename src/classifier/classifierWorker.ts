import * as ort from 'onnxruntime-web/wasm'

import { loadAssets, type FetchStaged } from '~/classifier/assets'
import type { ClassifierRequest, ClassifierResponse } from '~/classifier/messages'
import { QuestionClassifier, type OrtLike } from '~/classifier/session'

const root = new URL('/', self.location.href)
ort.env.wasm.wasmPaths = new URL('ort/', root).toString()
ort.env.wasm.numThreads = 1
ort.env.wasm.proxy = false

const fetchStaged: FetchStaged = async (name) => {
  const response = await fetch(new URL(`classifier/${name}`, root))
  if (!response.ok) throw new Error(`cannot read ${name}: ${response.status}`)
  return response.arrayBuffer()
}

let pending: Promise<{
  classifier: QuestionClassifier
  modelVersion: string
  runtimeId: string
  labels: number
  loadMs: number
}> | null = null

function load() {
  pending ??= (async () => {
    const started = Date.now()
    const { assets, model, runtimeId } = await loadAssets(fetchStaged)
    const classifier = await QuestionClassifier.create(ort as unknown as OrtLike, model, assets)
    return {
      classifier,
      modelVersion: assets.modelVersion,
      runtimeId,
      labels: assets.labelMap.labels.length,
      loadMs: Date.now() - started,
    }
  })().catch((error: unknown) => {
    pending = null
    throw error
  })
  return pending
}

async function answer(request: ClassifierRequest): Promise<ClassifierResponse> {
  try {
    const loaded = await load()
    if (request.kind === 'classify') {
      return {
        id: request.id,
        ok: true,
        kind: 'classify',
        decisions: await loaded.classifier.classify(request.requests),
        runtimeId: loaded.runtimeId,
      }
    }
    return {
      id: request.id,
      ok: true,
      kind: 'status',
      modelVersion: loaded.modelVersion,
      runtimeId: loaded.runtimeId,
      labels: loaded.labels,
      loadMs: loaded.loadMs,
    }
  } catch (error) {
    return { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

let queue = Promise.resolve()

self.addEventListener('message', (event: MessageEvent<ClassifierRequest>) => {
  const request = event.data
  queue = queue.then(async () => {
    self.postMessage(await answer(request))
  })
})

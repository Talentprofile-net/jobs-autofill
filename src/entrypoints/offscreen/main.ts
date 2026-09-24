import * as ort from 'onnxruntime-web/wasm'
import { browser } from 'wxt/browser'

import { loadAssets } from '~/classifier/assets'
import {
  CLASSIFIER_PORT,
  type ClassifierRequest,
  type ClassifierResponse,
} from '~/classifier/messages'
import { QuestionClassifier, type OrtLike } from '~/classifier/session'

ort.env.wasm.wasmPaths = new URL('ort/', browser.runtime.getURL('/')).toString()
ort.env.wasm.numThreads = 1

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
    const { assets, model, runtimeId } = await loadAssets()
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

browser.runtime.onConnect.addListener((port) => {
  if (port.name !== CLASSIFIER_PORT) return
  port.onMessage.addListener((message) => {
    const request = message as ClassifierRequest
    answer(request).then((response) => {
      try {
        port.postMessage(response)
      } catch {}
    })
  })
})

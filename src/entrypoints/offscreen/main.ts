import * as ort from 'onnxruntime-web/wasm'
import { browser } from 'wxt/browser'

import { loadAssets } from '~/classifier/assets'
import {
  CLASSIFY_MESSAGE,
  STATUS_MESSAGE,
  type ClassifierMessage,
  type ClassifyResponse,
  type StatusResponse,
} from '~/classifier/messages'
import { QuestionClassifier, type OrtLike } from '~/classifier/session'

ort.env.wasm.wasmPaths = new URL('ort/', browser.runtime.getURL('/')).toString()
ort.env.wasm.numThreads = 1

let pending: Promise<{ classifier: QuestionClassifier; modelVersion: string; labels: number; loadMs: number }> | null =
  null

function load() {
  pending ??= (async () => {
    const started = Date.now()
    const { assets, model } = await loadAssets()
    const classifier = await QuestionClassifier.create(ort as unknown as OrtLike, model, assets)
    return {
      classifier,
      modelVersion: assets.modelVersion,
      labels: assets.labelMap.labels.length,
      loadMs: Date.now() - started,
    }
  })()
  return pending
}

function fail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

browser.runtime.onMessage.addListener((
  message: ClassifierMessage,
  _sender: unknown,
  sendResponse: (response: ClassifyResponse | StatusResponse) => void,
) => {
  if (message?.kind === CLASSIFY_MESSAGE) {
    load()
      .then(({ classifier }) => classifier.classify(message.requests))
      .then((decisions) => sendResponse({ ok: true, decisions } satisfies ClassifyResponse))
      .catch((error) => sendResponse({ ok: false, error: fail(error) } satisfies ClassifyResponse))
    return true
  }
  if (message?.kind === STATUS_MESSAGE) {
    load()
      .then(({ modelVersion, labels, loadMs }) =>
        sendResponse({ ok: true, modelVersion, labels, loadMs } satisfies StatusResponse),
      )
      .catch((error) => sendResponse({ ok: false, error: fail(error) } satisfies StatusResponse))
    return true
  }
  return false
})

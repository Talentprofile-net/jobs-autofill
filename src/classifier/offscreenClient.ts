import { browser } from 'wxt/browser'

import type { AnswerKind, ClassifierInput, Decision } from '~/classifier/contract'
import {
  CLASSIFIER_PORT,
  type ClassifierRequestBody,
  type ClassifierResponse,
} from '~/classifier/messages'

export const OFFSCREEN_PATH = 'offscreen.html'
const JUSTIFICATION = 'Runs the local question classifier so form fields never leave the device.'

type Port = ReturnType<typeof browser.runtime.connect>

let creating: Promise<unknown> | null = null
let channel: Port | null = null
let nextId = 1
const waiting = new Map<number, { done: (value: ClassifierResponse) => void; fail: (error: Error) => void }>()

export class ClassifierDisconnected extends Error {
  constructor() {
    super('the classifier disconnected')
  }
}

export class ClassifierClosed extends Error {
  constructor() {
    super('the classifier was closed')
  }
}

async function documentExists(): Promise<boolean> {
  const contexts = await browser.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [browser.runtime.getURL(`/${OFFSCREEN_PATH}`)],
  })
  return contexts.length > 0
}

export async function ensureOffscreenDocument(): Promise<void> {
  if (await documentExists()) return
  creating ??= browser.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['WORKERS'],
      justification: JUSTIFICATION,
    })
    .finally(() => {
      creating = null
    })
  try {
    await creating
  } catch (error) {
    if (!(await documentExists())) throw error
  }
}

function connect(): Port {
  if (channel) return channel
  const port = browser.runtime.connect({ name: CLASSIFIER_PORT })
  port.onMessage.addListener((message) => {
    const response = message as ClassifierResponse
    const pending = waiting.get(response.id)
    if (!pending) return
    waiting.delete(response.id)
    pending.done(response)
  })
  port.onDisconnect.addListener(() => {
    channel = null
    for (const [id, pending] of waiting) {
      waiting.delete(id)
      pending.fail(new ClassifierDisconnected())
    }
  })
  channel = port
  return port
}

async function send(request: ClassifierRequestBody): Promise<ClassifierResponse> {
  await ensureOffscreenDocument()
  const port = connect()
  const id = nextId++
  return new Promise<ClassifierResponse>((done, fail) => {
    waiting.set(id, { done, fail })
    try {
      port.postMessage({ ...request, id })
    } catch {
      waiting.delete(id)
      fail(new ClassifierDisconnected())
    }
  })
}

// The offscreen document can go away under us: Chrome may reclaim it, another
// caller may close it, or the extension may reload. That loses the in-flight
// request but nothing else, so one retry reopens the document and asks again.
async function ask(request: ClassifierRequestBody): Promise<ClassifierResponse> {
  try {
    return await send(request)
  } catch (error) {
    if (!(error instanceof ClassifierDisconnected)) throw error
    channel = null
    return send(request)
  }
}

export function disconnectClassifier(): void {
  channel?.disconnect()
  channel = null
  for (const [id, pending] of waiting) {
    waiting.delete(id)
    pending.fail(new ClassifierClosed())
  }
}

export async function closeOffscreenDocument(): Promise<void> {
  disconnectClassifier()
  if (await documentExists()) await browser.offscreen.closeDocument()
}

export type Classification = { decisions: Decision[]; runtimeId: string }

export async function classifyWithRuntime(
  requests: { input: ClassifierInput; answerKind: AnswerKind }[],
): Promise<Classification> {
  const response = await ask({ kind: 'classify', requests })
  if (!response.ok) throw new Error(response.error)
  if (response.kind !== 'classify') throw new Error('the classifier answered the wrong request')
  if (response.decisions.length !== requests.length) throw new Error('the classifier skipped a request')
  return { decisions: response.decisions, runtimeId: response.runtimeId }
}

export async function classifyQuestions(
  requests: { input: ClassifierInput; answerKind: AnswerKind }[],
): Promise<Decision[]> {
  if (!requests.length) return []
  return (await classifyWithRuntime(requests)).decisions
}

export async function classifierStatus(): Promise<{
  modelVersion: string
  runtimeId: string
  labels: number
  loadMs: number
}> {
  const response = await ask({ kind: 'status' })
  if (!response.ok) throw new Error(response.error)
  if (response.kind !== 'status') throw new Error('the classifier answered the wrong request')
  return {
    modelVersion: response.modelVersion,
    runtimeId: response.runtimeId,
    labels: response.labels,
    loadMs: response.loadMs,
  }
}

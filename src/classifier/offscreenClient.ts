import { browser } from 'wxt/browser'

import type { AnswerKind, ClassifierInput, Decision } from '~/classifier/contract'
import {
  CLASSIFY_MESSAGE,
  STATUS_MESSAGE,
  type ClassifyResponse,
  type StatusResponse,
} from '~/classifier/messages'

export const OFFSCREEN_PATH = 'offscreen.html'
const JUSTIFICATION = 'Runs the local question classifier so form fields never leave the device.'

let creating: Promise<unknown> | null = null

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

export async function closeOffscreenDocument(): Promise<void> {
  if (await documentExists()) await browser.offscreen.closeDocument()
}

export async function classifyQuestions(
  requests: { input: ClassifierInput; answerKind: AnswerKind }[],
): Promise<Decision[]> {
  if (!requests.length) return []
  await ensureOffscreenDocument()
  const response = (await browser.runtime.sendMessage({
    kind: CLASSIFY_MESSAGE,
    requests,
  })) as ClassifyResponse
  if (!response?.ok) throw new Error(response?.error ?? 'the classifier did not answer')
  return response.decisions
}

export async function classifierStatus(): Promise<StatusResponse> {
  await ensureOffscreenDocument()
  return (await browser.runtime.sendMessage({ kind: STATUS_MESSAGE })) as StatusResponse
}

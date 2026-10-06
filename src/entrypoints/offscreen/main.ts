import { browser } from 'wxt/browser'

import {
  CLASSIFIER_PORT,
  type ClassifierRequest,
  type ClassifierResponse,
} from '~/classifier/messages'

type Port = ReturnType<typeof browser.runtime.connect>
type Job = { port: Port; request: ClassifierRequest; workerId: number }

let worker: Worker | null = null
let running: Job | null = null
let queue: Job[] = []
let nextWorkerId = 1

const reply = (port: Port, response: ClassifierResponse) => {
  try {
    port.postMessage(response)
  } catch {}
}

function failRunning(error: string): void {
  const job = running
  running = null
  if (job) reply(job.port, { id: job.request.id, ok: false, error })
}

function startWorker(): Worker {
  const created = new Worker(new URL('../../classifier/classifierWorker.ts', import.meta.url), {
    type: 'module',
    name: 'classifier',
  })
  created.addEventListener('message', (event: MessageEvent<ClassifierResponse>) => {
    if (created !== worker || !running || event.data.id !== running.workerId) return
    const job = running
    running = null
    reply(job.port, { ...event.data, id: job.request.id })
    pump()
  })
  created.addEventListener('error', (event) => {
    if (created !== worker) return
    event.preventDefault()
    worker?.terminate()
    worker = null
    failRunning(event.message || 'the classifier worker failed')
    pump()
  })
  return created
}

function pump(): void {
  if (running) return
  const job = queue.shift()
  if (!job) return
  running = job
  worker ??= startWorker()
  worker.postMessage({ ...job.request, id: job.workerId })
}

function release(port: Port): void {
  queue = queue.filter((job) => job.port !== port)
}

browser.runtime.onConnect.addListener((port) => {
  if (port.name !== CLASSIFIER_PORT) return
  port.onMessage.addListener((message) => {
    queue.push({ port, request: message as ClassifierRequest, workerId: nextWorkerId++ })
    pump()
  })
  port.onDisconnect.addListener(() => release(port))
})

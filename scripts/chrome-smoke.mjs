import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.CHROME_SMOKE_PORT ?? 9333)
const TIMEOUT_MS = Number(process.env.CHROME_SMOKE_TIMEOUT_MS ?? 300_000)
const root = resolve(import.meta.dirname, '..')
const extension = resolve(root, '.output/chrome-mv3')

const wait = (ms) => new Promise((done) => setTimeout(done, ms))

// The page runs the real exported client, bundled from source, so request
// correlation, reconnection and disconnect handling are the shipped code rather
// than a copy written for this test.
async function bundleClient(workDir) {
  const entry = join(workDir, 'harness.ts')
  const outfile = join(workDir, 'harness.js')
  await writeFile(
    entry,
    `import {
  classifyQuestions,
  classifierStatus,
  ensureOffscreenDocument,
  disconnectClassifier,
  closeOffscreenDocument,
} from '${resolve(root, 'src/classifier/offscreenClient.ts')}'

globalThis.__classifier = {
  classifyQuestions,
  classifierStatus,
  ensureOffscreenDocument,
  disconnectClassifier,
  closeOffscreenDocument,
}
`,
  )
  const build = spawn('bun', ['build', entry, '--target=browser', '--format=iife', `--outfile=${outfile}`], {
    cwd: root,
    stdio: 'inherit',
  })
  const code = await new Promise((done) => build.on('close', done))
  if (code !== 0) throw new Error('bundling the classifier client failed')
  return readFile(outfile, 'utf8')
}

async function endpoint(path) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}${path}`)
      if (response.ok) return await response.json()
    } catch {}
    await wait(500)
  }
  throw new Error(`devtools endpoint ${path} never answered`)
}

class Session {
  constructor(url) {
    this.socket = new WebSocket(url)
    this.next = 1
    this.pending = new Map()
    this.ready = new Promise((done, fail) => {
      this.socket.onopen = () => done()
      this.socket.onerror = (event) => fail(new Error(`websocket failed: ${event?.message ?? 'unknown'}`))
    })
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data)
      const waiting = this.pending.get(message.id)
      if (!waiting) return
      this.pending.delete(message.id)
      message.error ? waiting.fail(new Error(message.error.message)) : waiting.done(message.result)
    }
  }

  async send(method, params = {}, sessionId) {
    await this.ready
    const id = this.next++
    const payload = JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params })
    return new Promise((done, fail) => {
      this.pending.set(id, { done, fail })
      this.socket.send(payload)
    })
  }

  close() {
    this.socket.close()
  }
}

async function evaluate(session, sessionId, expression, timeoutMs = TIMEOUT_MS) {
  const result = await Promise.race([
    session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId),
    wait(timeoutMs).then(() => {
      throw new Error(`evaluation timed out after ${timeoutMs} ms`)
    }),
  ])
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'evaluation failed')
  }
  return result.result.value
}

const checks = []
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail })
  if (!condition) throw new Error(`${name} failed${detail ? `: ${detail}` : ''}`)
}

function sameDecision(actual, expected) {
  return (
    actual.labelEnumId === expected.labelEnumId &&
    actual.abstentionReason === expected.abstentionReason &&
    actual.topLabelEnumId === expected.topLabelEnumId &&
    Math.abs(actual.calibratedConfidence - expected.calibratedConfidence) < 1e-6
  )
}

const fixture = JSON.parse(await readFile(resolve(root, 'src/classifier/__fixtures__/parity.json'), 'utf8'))
// The first case carries a non-breaking space on purpose: it proves the page
// collapses whitespace exactly as python does. Kept as an escape so no editor
// can silently rewrite it.
const wanted = ['  First   Name\u00a0 ', 'Nombre', '']
const expected = wanted.map((question) => {
  const found = fixture.cases.find((item) => item.input.questionText === question)
  if (!found) throw new Error(`fixture case missing for ${JSON.stringify(question)}`)
  return found
})
const requests = expected.map((item) => ({ input: item.input, answerKind: item.answerKind }))
const REQUESTS = JSON.stringify(requests)
const CALL = (body) => `(async () => { ${body} })()`
const CLASSIFY = CALL(`const started = Date.now()
  const decisions = await __classifier.classifyQuestions(${REQUESTS})
  return { ms: Date.now() - started, decisions }`)

const workDir = await mkdtemp(join(tmpdir(), 'tp-smoke-build-'))
const clientBundle = await bundleClient(workDir)
const profile = await mkdtemp(join(tmpdir(), 'tp-smoke-'))
const chrome = spawn(
  CHROME,
  [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT}`,
    `--load-extension=${extension}`,
    `--disable-extensions-except=${extension}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--headless=new',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const report = []
let failure = null
try {
  const version = await endpoint('/json/version')
  const browser = new Session(version.webSocketDebuggerUrl)
  report.push(`chrome ${version.Browser}`)

  let worker = null
  for (let attempt = 0; attempt < 60 && !worker; attempt += 1) {
    const targets = await browser.send('Target.getTargets')
    worker = targets.targetInfos.find(
      (target) => target.type === 'service_worker' && target.url.endsWith('/background.js'),
    )
    if (!worker) await wait(500)
  }
  if (!worker) throw new Error('the extension service worker never appeared')
  const extensionId = new URL(worker.url).host
  report.push(`extension ${extensionId}`)

  const attach = async (targetId) =>
    (await browser.send('Target.attachToTarget', { targetId, flatten: true })).sessionId

  const driver = await browser.send('Target.createTarget', {
    url: `chrome-extension://${extensionId}/popup.html`,
  })
  const driverSession = await attach(driver.targetId)
  await wait(1000)
  await evaluate(browser, driverSession, clientBundle, 30_000)
  check(
    'the exported client loads in an extension page',
    (await evaluate(browser, driverSession, 'typeof __classifier.classifyQuestions')) === 'function',
  )

  const cold = await evaluate(browser, driverSession, CLASSIFY)
  report.push(`cold start ${cold.ms} ms`)
  check('the cold call answers every request', cold.decisions.length === requests.length)
  cold.decisions.forEach((decision, index) => {
    check(
      `decision ${index} (${expected[index].note}) matches the python fixture`,
      sameDecision(decision, expected[index].decision),
      `${JSON.stringify(decision)} vs ${JSON.stringify(expected[index].decision)}`,
    )
  })
  report.push(
    `  ${cold.decisions
      .map(
        (decision, index) =>
          `${expected[index].note}: ${decision.labelEnumId ? 'fill' : `abstain:${decision.abstentionReason}`}@${decision.calibratedConfidence.toFixed(3)}`,
      )
      .join(', ')}`,
  )

  const warm = await evaluate(browser, driverSession, CLASSIFY)
  report.push(`warm ${warm.ms} ms`)
  check('the warm call repeats the same decisions', JSON.stringify(warm.decisions) === JSON.stringify(cold.decisions))

  const concurrent = await evaluate(
    browser,
    driverSession,
    CALL(`const [first, second] = await Promise.all([
      __classifier.classifyQuestions([${JSON.stringify(requests[0])}]),
      __classifier.classifyQuestions([${JSON.stringify(requests[1])}]),
    ])
    return { first: first[0], second: second[0] }`),
  )
  check(
    'two in-flight requests each get their own answer',
    sameDecision(concurrent.first, expected[0].decision) && sameDecision(concurrent.second, expected[1].decision),
    JSON.stringify(concurrent),
  )
  report.push('request correlation: two concurrent calls resolved to their own results')

  const status = await evaluate(browser, driverSession, CALL('return await __classifier.classifierStatus()'))
  check('status reports the staged model version', status.modelVersion === fixture.modelVersion, JSON.stringify(status))
  check('status reports a label count', status.labels > 0, JSON.stringify(status))
  report.push(`status: ${status.modelVersion}, ${status.labels} labels, ${status.loadMs} ms load`)

  const reconnected = await evaluate(
    browser,
    driverSession,
    CALL(`__classifier.disconnectClassifier()
      const decisions = await __classifier.classifyQuestions(${REQUESTS})
      return { decisions }`),
  )
  check(
    'the client reconnects after an explicit disconnect',
    JSON.stringify(reconnected.decisions) === JSON.stringify(cold.decisions),
  )
  report.push('reconnection after disconnect: same decisions')

  const offscreenBefore = await evaluate(
    browser,
    driverSession,
    `chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).then((c) => c.length)`,
  )
  check('one offscreen document is open', offscreenBefore === 1, `saw ${offscreenBefore}`)

  let terminated = 'unknown'
  try {
    await browser.send('ServiceWorker.enable')
    await browser.send('ServiceWorker.stopAllWorkers')
    terminated = 'ServiceWorker.stopAllWorkers'
  } catch {
    await browser.send('Target.closeTarget', { targetId: worker.targetId })
    terminated = 'Target.closeTarget'
  }
  await wait(2000)
  const targetsAfter = await browser.send('Target.getTargets')
  const workerAlive = targetsAfter.targetInfos.some((target) => target.targetId === worker.targetId)
  check('the service worker is gone', !workerAlive, `terminated with ${terminated}`)
  report.push(`service worker terminated with ${terminated}`)

  const afterKill = await evaluate(browser, driverSession, CLASSIFY)
  report.push(`after termination ${afterKill.ms} ms`)
  check(
    'decisions are unchanged after the service worker is terminated',
    JSON.stringify(afterKill.decisions) === JSON.stringify(cold.decisions),
  )

  const midFlight = await evaluate(
    browser,
    driverSession,
    CALL(`const inFlight = __classifier.classifyQuestions(${REQUESTS})
      await chrome.offscreen.closeDocument()
      const decisions = await inFlight
      return { decisions, contexts: await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).then((c) => c.length) }`),
  )
  check(
    'a request survives the offscreen document closing under it',
    JSON.stringify(midFlight.decisions) === JSON.stringify(cold.decisions),
    JSON.stringify(midFlight).slice(0, 200),
  )
  report.push('offscreen document closed mid-request: the call still answered')

  const closed = await evaluate(
    browser,
    driverSession,
    CALL(`await __classifier.closeOffscreenDocument()
      return await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).then((c) => c.length)`),
  )
  check('closeOffscreenDocument removes the document', closed === 0, `saw ${closed}`)

  const reopened = await evaluate(
    browser,
    driverSession,
    CALL(`const decisions = await __classifier.classifyQuestions(${REQUESTS})
      const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).then((c) => c.length)
      return { decisions, contexts }`),
  )
  check('the client reopens the document on the next call', reopened.contexts === 1)
  check('decisions survive a full reload', JSON.stringify(reopened.decisions) === JSON.stringify(cold.decisions))
  report.push('closed and reopened the offscreen document: same decisions')
  browser.close()
} catch (error) {
  failure = error
} finally {
  chrome.kill('SIGKILL')
  await wait(500)
  await rm(profile, { recursive: true, force: true })
  await rm(workDir, { recursive: true, force: true })
}

console.log(report.join('\n'))
console.log(checks.map((item) => `${item.ok ? 'ok  ' : 'FAIL'} ${item.name}`).join('\n'))
if (failure) {
  console.error(`FAILED: ${failure.message}`)
  process.exit(1)
}
console.log(`chrome smoke passed: ${checks.length} checks`)

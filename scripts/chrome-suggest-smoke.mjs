import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.CHROME_SMOKE_PORT ?? 9334)
const TIMEOUT_MS = Number(process.env.CHROME_SMOKE_TIMEOUT_MS ?? 300_000)
const root = resolve(import.meta.dirname, '..')
const build = resolve(root, '.output/chrome-mv3')
const website = resolve(process.env.PUBLIC_WEBSITE_DIR ?? resolve(root, '../public-website'))
const fixture = JSON.parse(await readFile(resolve(root, 'src/classifier/__fixtures__/parity.json'), 'utf8'))
const staged = JSON.parse(await readFile(resolve(root, 'public/classifier/model-version.json'), 'utf8'))
const builtVersion = JSON.parse(await readFile(resolve(build, 'classifier/model-version.json'), 'utf8'))
const labelNames = new Map(
  JSON.parse(await readFile(resolve(build, 'classifier/labels.json'), 'utf8')).labels.map((entry) => [
    entry.labelEnumId,
    entry.label,
  ]),
)
const sha256 = async (path) => createHash('sha256').update(await readFile(path)).digest('hex')

const SITE = 'https://talentprofile.net'
const ATS = 'https://job-boards.greenhouse.io'
const EXTENSION_NAME = 'TalentProfile Autofill'
const BRIDGE_MAGIC = 'tp:bridge'
const SWITCH_KEY = 'tp.classifierSuggestions'
const ANSWER_LABELS_KEY = 'tp.classifier.answerLabels'
const TOKENS_KEY = 'tp.tokens'
const PROFILE_KEY = 'tp.profileCache'

const wait = (ms) => new Promise((done) => setTimeout(done, ms))

const pick = (question, fieldType, country, optionCount) => {
  const found = fixture.cases.find(
    (item) =>
      item.input.questionText === question &&
      item.input.fieldType === fieldType &&
      item.input.jobCountry === country &&
      item.input.optionLabels.length === optionCount,
  )
  if (!found) throw new Error(`fixture case missing: ${question} ${fieldType} ${country} ${optionCount}`)
  return found
}

const ACCEPTED = pick('Degree', 'Combobox', 'US', 0)
const WITH_OPTIONS = pick('Degree', 'Combobox', 'US', 3)
const COUNTRY_DE = pick('Gender', 'RadioGroup', 'DE', 4)
const COUNTRY_GB = pick('Select one', 'RadioGroup', 'GB', 60)
const PAGE_ACCEPTED = pick('First Name*', 'TextInput', 'BB', 0)
const PAGE_ABSTAINED = pick('Do you have any links you would like to share', 'TextInput', 'BD', 0)
const PAGE_NO_ANSWER = pick('Portfolio URL', 'TextInput', 'BA', 0)
const EXACT_QUESTION = 'Preferred pronouns'
const OVERLAP_FIELD = 'Expected annual salary (euros)'
const OVERLAP_STORED = 'Expected annual salary in euros'
const LINKED_CANDIDATES = ['Legal first name', 'Given name', 'Your first name']
const LINKED_VALUE = 'Smoke Linked Answer'
const EXACT_VALUE = 'Smoke Exact Answer'
const OVERLAP_VALUE = 'Smoke Overlap Answer'

const base64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const TOKENS = {
  accessToken: [
    base64url({ alg: 'none', typ: 'JWT' }),
    base64url({ email: 'smoke@example.invalid', exp: 4102444800, iat: 1790000000, sub: 'smoke-user' }),
    Buffer.from('smoke-test-signature').toString('base64url'),
  ].join('.'),
  method: 'local',
  refreshToken: 'smoke-refresh-token',
}
const PROFILE = {
  description: null,
  education: [],
  experience: [],
  hourlyRate: null,
  id: 'smoke-profile',
  isAvailableForHire: null,
  isInterestedInRelocation: null,
  jobTitle: 'Smoke Test Engineer',
  languages: [],
  links: [],
  location: null,
  monthlyRate: null,
  profileName: 'Smoke Test',
  rateCurrency: null,
  skills: [],
  talentAnswers: [],
  talentNotes: [],
  totalExperience: null,
  user: { email: 'smoke@example.invalid', phoneNumber: null },
}

const requestFor = (item) => ({
  answerKind: item.answerKind,
  fieldType: item.input.fieldType,
  optionLabels: item.input.optionLabels,
  questionText: item.input.questionText,
})

const MALFORMED = [
  ['an unknown answer kind', { answerKind: 'legacy', fieldType: 'TextInput', optionLabels: [], questionText: 'Degree' }],
  ['a question one over 4,096 characters', { ...requestFor(ACCEPTED), questionText: 'x'.repeat(4_097) }],
  ['61 options', { ...requestFor(ACCEPTED), optionLabels: Array.from({ length: 61 }, (_, index) => `option ${index}`) }],
  ['an option one over 4,096 characters', { ...requestFor(ACCEPTED), optionLabels: ['x'.repeat(4_097)] }],
  [
    'option text one over 65,536 characters in total',
    { ...requestFor(ACCEPTED), optionLabels: [...Array.from({ length: 16 }, () => 'x'.repeat(4_096)), 'x'] },
  ],
]

async function bundle(workDir, name, source) {
  const entry = join(workDir, `${name}.ts`)
  const outfile = join(workDir, `${name}.js`)
  await writeFile(entry, source)
  const child = spawn('bun', ['build', entry, '--target=browser', '--format=iife', `--outfile=${outfile}`], {
    cwd: root,
    stdio: 'ignore',
  })
  if ((await new Promise((done) => child.on('close', done))) !== 0) throw new Error(`bundling ${name} failed`)
  return readFile(outfile, 'utf8')
}

const harnessSource = `import { requestSuggestionFromBackground } from '${resolve(root, 'src/classifier/suggestClient.ts')}'
import { classifierStatus, classifyQuestions, closeOffscreenDocument } from '${resolve(root, 'src/classifier/offscreenClient.ts')}'
import { normalizeQuestion } from '${resolve(root, 'src/resolver/normalizeQuestion.ts')}'

globalThis.__attempts = 0

const send = async (message) => {
  globalThis.__attempts += 1
  try {
    return (await chrome.runtime.sendMessage(message)) ?? { ok: false, error: 'no response' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

globalThis.__suggest = (request) => requestSuggestionFromBackground(send, request)
globalThis.__classify = classifyQuestions
globalThis.__closeClassifier = closeOffscreenDocument
globalThis.__status = classifierStatus
globalThis.__normalizeQuestion = normalizeQuestion
`

async function bundleWebsite(workDir) {
  const handoff = resolve(website, 'src/lib/utils/extension-application-handoff.ts')
  if (!existsSync(handoff)) throw new Error(`public website source not found at ${website}; set PUBLIC_WEBSITE_DIR`)
  const entry = join(workDir, 'website.ts')
  const script = join(workDir, 'build-website.ts')
  const outfile = join(workDir, 'website.js')
  await writeFile(
    entry,
    `import { jobCountryForExtension } from '${handoff}'\nglobalThis.__jobCountryForExtension = jobCountryForExtension\n`,
  )
  await writeFile(
    script,
    `import { resolve } from 'node:path'
const result = await Bun.build({
  entrypoints: [${JSON.stringify(entry)}],
  target: 'browser',
  format: 'iife',
  plugins: [{
    name: 'sveltekit-aliases',
    setup(build) {
      build.onResolve({ filter: /^\\$env\\/static\\/public$/ }, () => ({ path: 'public', namespace: 'env' }))
      build.onLoad({ filter: /.*/, namespace: 'env' }, () => ({ contents: "export const PUBLIC_URL = '${SITE}'", loader: 'js' }))
      build.onResolve({ filter: /^\\$lib\\// }, (args) => ({ path: resolve(${JSON.stringify(website)}, 'src/lib', args.path.slice(5) + '.ts') }))
    },
  }],
})
if (!result.success) {
  console.error(result.logs.join('\\n'))
  process.exit(1)
}
await Bun.write(${JSON.stringify(outfile)}, await result.outputs[0].text())
`,
  )
  const child = spawn('bun', [script], { cwd: website, stdio: 'inherit' })
  if ((await new Promise((done) => child.on('close', done))) !== 0) throw new Error('bundling the website handoff failed')
  return readFile(outfile, 'utf8')
}

const FIELDS = [
  ['f-first', 'first', PAGE_ACCEPTED.input.questionText],
  ['f-links', 'links', PAGE_ABSTAINED.input.questionText],
  ['f-portfolio', 'portfolio', PAGE_NO_ANSWER.input.questionText],
  ['f-exact', 'exact', EXACT_QUESTION],
  ['f-overlap', 'overlap', OVERLAP_FIELD],
]

const ATS_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Apply</title>
<style>body{font:14px sans-serif;margin:24px}.field{position:relative;width:420px;margin:0 0 28px}input{width:360px;padding:6px}</style>
</head><body>
<div class="application--container">
  <div jaf-section="personal">
${FIELDS.map(([wrapper, input, label]) => `    <div class="field" id="${wrapper}"><div class="text-input-wrapper"><label for="${input}">${label}</label><input id="${input}" type="text"></div></div>`).join('\n')}
  </div>
</div>
</body></html>`

const sitePage = (websiteBundle) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Job</title></head><body>
<script>${websiteBundle}</script>
<script>
globalThis.__handoff = (extensionId, applicationId, destinationUrl, country) =>
  new Promise((done) => {
    const message = {
      destinationUrl,
      jobCountry: __jobCountryForExtension(country),
      kind: 'application.handoff',
      talentJobApplicationId: applicationId,
    }
    chrome.runtime.sendMessage(extensionId, message, (response) => done({ response, sent: message.jobCountry }))
  })
globalThis.__rawHandoff = (extensionId, applicationId, destinationUrl, jobCountry) =>
  new Promise((done) => {
    chrome.runtime.sendMessage(
      extensionId,
      { destinationUrl, jobCountry, kind: 'application.handoff', talentJobApplicationId: applicationId },
      (response) => done({ response, sent: jobCountry }),
    )
  })
</script>
</body></html>`

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
    this.listeners = []
    this.ready = new Promise((done, fail) => {
      this.socket.onopen = () => done()
      this.socket.onerror = (event) => fail(new Error(`websocket failed: ${event?.message ?? 'unknown'}`))
    })
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.method) {
        for (const listener of this.listeners) listener(message)
        return
      }
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

  on(listener) {
    this.listeners.push(listener)
  }

  close() {
    this.socket.close()
  }
}

async function evaluate(session, sessionId, expression, timeoutMs = TIMEOUT_MS, extra = {}) {
  const result = await Promise.race([
    session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...extra }, sessionId),
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

const close = (a, b) => Math.abs(a - b) < 1e-6

function matchesDecision(suggestion, decision) {
  if (decision.labelEnumId) {
    return (
      suggestion.status === 'classified' &&
      suggestion.labelEnumId === decision.labelEnumId &&
      close(suggestion.confidence, decision.calibratedConfidence)
    )
  }
  return (
    suggestion.status === 'abstained' &&
    suggestion.reason === decision.abstentionReason &&
    suggestion.topLabelEnumId === decision.topLabelEnumId &&
    close(suggestion.confidence, decision.calibratedConfidence)
  )
}

const matchesFixture = (suggestion, item) => matchesDecision(suggestion, item.decision)

const secretsOf = (item) =>
  [
    fixture.modelVersion,
    item.decision.topLabelEnumId,
    labelNames.get(item.decision.topLabelEnumId),
    item.decision.labelEnumId,
    item.decision.abstentionReason,
    String(item.decision.calibratedConfidence).slice(0, 7),
  ].filter((secret) => typeof secret === 'string' && secret.length > 0)

const exposure = (messages, item) => {
  const problems = secretsOf(item).filter((secret) => messages.some((message) => message.includes(secret)))
  for (const message of messages) {
    const payload = JSON.parse(message).payload
    if (payload?.kind !== 'classifier.suggestResult') continue
    const keys = Object.keys(payload).sort().join(',')
    if (keys !== 'id,kind,row') problems.push(`result keys ${keys}`)
    if (payload.row !== null && Object.keys(payload.row).sort().join(',') !== 'title,value') {
      problems.push(`row keys ${Object.keys(payload.row).join(',')}`)
    }
  }
  return problems
}

const CALL = (body) => `(async () => { ${body} })()`
const SUGGEST = (request) => CALL(`return await __suggest(${JSON.stringify(request)})`)
const CLASSIFY = (request, jobCountry) =>
  CALL(`const [decision] = await __classify([{ answerKind: ${JSON.stringify(request.answerKind)}, input: { questionText: ${JSON.stringify(request.questionText)}, fieldType: ${JSON.stringify(request.fieldType)}, jobCountry: ${JSON.stringify(jobCountry)}, optionLabels: ${JSON.stringify(request.optionLabels)} } }])
    return decision`)
const OFFSCREEN_COUNT = `chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).then((c) => c.length)`
const SET_SWITCH = (enabled) => CALL(`await chrome.storage.local.set({ '${SWITCH_KEY}': ${enabled} })`)
const BIND = (tabId, destinationUrl, country) =>
  CALL(`await chrome.storage.session.set({ 'tp.applicationContext.tab.${tabId}': { applicationId: 'smoke', destinationUrl: ${JSON.stringify(destinationUrl)}, jobCountry: ${JSON.stringify(country)} } })
    return true`)
const UNBIND = (tabId) => CALL(`await chrome.storage.session.remove('tp.applicationContext.tab.${tabId}')`)
const BOUND_CONTEXT = (tabId) =>
  CALL(`const key = 'tp.applicationContext.tab.${tabId}'
    return (await chrome.storage.session.get(key))[key] ?? null`)
const HARNESS_TAB = CALL(`return (await chrome.tabs.getCurrent()).id`)

const PAGE_BRIDGE_REQUEST = (request) =>
  CALL(`const seen = []
    const id = crypto.randomUUID()
    const answered = new Promise((done) => {
      const listener = (event) => {
        if (event.data?.magic !== '${BRIDGE_MAGIC}') return
        seen.push(JSON.stringify(event.data))
        if (event.data.from === 'content' && event.data.payload?.id === id) {
          removeEventListener('message', listener)
          done(event.data.payload)
        }
      }
      addEventListener('message', listener)
    })
    postMessage({ magic: '${BRIDGE_MAGIC}', from: 'main', payload: { id, kind: 'classifier.suggest', request: ${JSON.stringify(request)} } }, location.origin)
    const result = await Promise.race([answered, new Promise((done) => setTimeout(() => done('timeout'), 150000))])
    return { result, seen }`)

const RECORD_BRIDGE = CALL(`window.__bridgeSeen = []
    window.__bridgeResults = 0
    if (!window.__bridgeRecorder) {
      window.__bridgeRecorder = (event) => {
        if (event.data?.magic !== '${BRIDGE_MAGIC}') return
        window.__bridgeSeen.push(JSON.stringify(event.data))
        if (event.data.payload?.kind === 'classifier.suggestResult') window.__bridgeResults += 1
      }
      addEventListener('message', window.__bridgeRecorder)
    }
    return true`)

const PICKER = `document.querySelector('[data-tp-picker]')?.shadowRoot`
const PICKER_STATE = CALL(`const shadow = ${PICKER}
    if (!shadow) return { open: false }
    const rows = [...shadow.querySelectorAll('[data-tp-suggestion]')]
    return {
      open: true,
      title: shadow.querySelector('.title')?.textContent?.trim() ?? null,
      signIn: Boolean(shadow.querySelector('.signin')),
      list: Boolean(shadow.querySelector('.list')),
      empty: shadow.querySelector('.list .empty')?.textContent?.trim() ?? null,
      items: shadow.querySelectorAll('.list .item-wrap').length,
      rows: rows.map((row) => ({
        badge: row.querySelector('.value')?.textContent?.trim() ?? null,
        compact: row.textContent.replace(/\\s+/g, ''),
        html: row.outerHTML,
        spans: row.querySelectorAll('span').length,
        title: row.querySelector('.label-text')?.textContent?.trim() ?? null,
      })),
      results: window.__bridgeResults ?? 0,
      seen: window.__bridgeSeen ?? [],
    }`)

const COUNT_SUGGEST_SENDS = CALL(`if (globalThis.__suggestSends === undefined) {
      globalThis.__suggestSends = 0
      const runtimes = new Set([globalThis.chrome?.runtime, globalThis.browser?.runtime].filter(Boolean))
      for (const runtime of runtimes) {
        const original = runtime.sendMessage.bind(runtime)
        runtime.sendMessage = (...args) => {
          if (args[0]?.kind === 'classifier.suggest') globalThis.__suggestSends += 1
          return original(...args)
        }
      }
    }
    globalThis.__suggestSends = 0
    return true`)

async function waitFor(read, test, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    try {
      last = await read()
      if (test(last)) return last
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await wait(200)
  }
  throw new Error(`timed out waiting for ${what}: ${JSON.stringify(last)?.slice(0, 400)}`)
}

const builtModel = await sha256(resolve(build, 'classifier/model.onnx'))
const stagedModel = await sha256(resolve(root, 'public/classifier/model.onnx'))
const workDir = await mkdtemp(join(tmpdir(), 'tp-suggest-build-'))
const extension = join(workDir, 'extension')
await cp(build, extension, { recursive: true })
const modelPath = join(extension, 'classifier/model.onnx')
const harness = await bundle(workDir, 'harness', harnessSource)
const websiteBundle = await bundleWebsite(workDir)
const profile = await mkdtemp(join(tmpdir(), 'tp-suggest-'))
const chrome = spawn(
  CHROME,
  [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT}`,
    `--load-extension=${extension}`,
    `--disable-extensions-except=${extension}`,
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost',
    '--no-first-run',
    '--no-default-browser-check',
    '--headless=new',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const report = []
let failure = null
let stopResuming = () => {}
try {
  check(
    'the build carries the staged model version',
    builtVersion.modelVersion === staged.modelVersion && staged.modelVersion === fixture.modelVersion,
    `${builtVersion.modelVersion} / ${staged.modelVersion} / ${fixture.modelVersion}`,
  )
  check('the built model bytes equal the staged model bytes', builtModel === stagedModel, `${builtModel} / ${stagedModel}`)
  report.push(`model ${staged.modelVersion} sha256 ${builtModel}`)

  const version = await endpoint('/json/version')
  const browser = new Session(version.webSocketDebuggerUrl)
  report.push(`chrome ${version.Browser}`)

  const autoSessions = new Map()
  const sessionTypes = new Map()
  const requests = []
  const intercepted = []
  const contexts = new Map()

  browser.on(async (message) => {
    if (message.method === 'Network.requestWillBeSent') {
      requests.push({ type: sessionTypes.get(message.sessionId) ?? 'unknown', url: message.params.request.url })
      return
    }
    if (message.method === 'Runtime.executionContextCreated') {
      const list = contexts.get(message.sessionId) ?? []
      list.push(message.params.context)
      contexts.set(message.sessionId, list)
      return
    }
    if (message.method === 'Runtime.executionContextDestroyed') {
      const list = contexts.get(message.sessionId) ?? []
      contexts.set(
        message.sessionId,
        list.filter((context) => context.id !== message.params.executionContextId),
      )
      return
    }
    if (message.method === 'Runtime.executionContextsCleared') {
      contexts.set(message.sessionId, [])
      return
    }
    if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params
      const url = new URL(request.url)
      intercepted.push(request.url)
      const page = url.origin === ATS ? ATS_PAGE : url.origin === SITE && url.pathname === '/job' ? sitePage(websiteBundle) : null
      try {
        if (page === null) {
          await browser.send('Fetch.failRequest', { errorReason: 'BlockedByClient', requestId }, message.sessionId)
        } else {
          await browser.send(
            'Fetch.fulfillRequest',
            {
              body: Buffer.from(page).toString('base64'),
              requestId,
              responseCode: 200,
              responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
            },
            message.sessionId,
          )
        }
      } catch {}
      return
    }
    if (message.method !== 'Target.attachedToTarget') return
    const { sessionId, targetInfo, waitingForDebugger } = message.params
    if (autoSessions.has(targetInfo.targetId)) return
    autoSessions.set(targetInfo.targetId, sessionId)
    sessionTypes.set(sessionId, targetInfo.type)
    try {
      await browser.send('Network.enable', {}, sessionId)
      if (targetInfo.type === 'page') {
        await browser.send('Fetch.enable', { patterns: [{ urlPattern: `${SITE}/*` }, { urlPattern: `${ATS}/*` }] }, sessionId)
      }
    } catch {}
    if (waitingForDebugger) await browser.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {})
  })
  await browser.send('Target.setAutoAttach', { autoAttach: true, flatten: true, waitForDebuggerOnStart: true })

  const attach = async (targetId) =>
    (await browser.send('Target.attachToTarget', { flatten: true, targetId })).sessionId

  const serviceWorker = async () => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const targets = await browser.send('Target.getTargets')
      const found = targets.targetInfos.find(
        (target) => target.type === 'service_worker' && target.url.endsWith('/background.js'),
      )
      if (found) return found
      await wait(500)
    }
    throw new Error('the extension service worker never appeared')
  }

  const resumeWorkers = setInterval(() => {
    for (const [session, type] of sessionTypes) {
      if (type !== 'service_worker') continue
      browser.send('Runtime.runIfWaitingForDebugger', {}, session).then(
        () => {},
        () => {},
      )
    }
  }, 200)
  stopResuming = () => clearInterval(resumeWorkers)

  const stopWorker = async () => {
    try {
      await browser.send('ServiceWorker.enable')
      await browser.send('ServiceWorker.stopAllWorkers')
      return 'ServiceWorker.stopAllWorkers'
    } catch {
      const current = (await browser.send('Target.getTargets')).targetInfos.find(
        (target) => target.type === 'service_worker' && target.url.endsWith('/background.js'),
      )
      if (!current) return 'no worker running'
      await browser.send('Target.closeTarget', { targetId: current.targetId })
      return 'Target.closeTarget'
    }
  }

  const worker = await serviceWorker()
  const extensionId = new URL(worker.url).host
  const extensionOrigin = `chrome-extension://${extensionId}`
  report.push(`extension ${extensionId} (copy of ${build})`)
  const page = await browser.send('Target.createTarget', { url: `${extensionOrigin}/popup.html` })
  const sessionId = await attach(page.targetId)
  await wait(1000)
  await evaluate(browser, sessionId, harness, 30_000)
  const run = (expression, timeoutMs) => evaluate(browser, sessionId, expression, timeoutMs)
  const offscreenCount = () => run(OFFSCREEN_COUNT)
  const harnessTab = await run(HARNESS_TAB)
  const harnessDestination = `${ATS}/smoke/harness`
  const classifierFetches = (from) => requests.slice(from).filter((request) => request.url.includes('/classifier/'))

  const workerSession = autoSessions.get((await serviceWorker()).targetId)
  const probeFrom = requests.length
  const probe = await evaluate(
    browser,
    workerSession,
    `fetch(chrome.runtime.getURL('/classifier/model-version.json')).then((response) => response.status)`,
    10_000,
  )
  await wait(300)
  check(
    'the network recorder sees a classifier asset fetch',
    probe === 200 && classifierFetches(probeFrom).length === 1,
    JSON.stringify(classifierFetches(probeFrom)),
  )

  const offFrom = requests.length
  const disabled = await run(SUGGEST(requestFor(ACCEPTED)))
  check('the switch is off by default and nothing is suggested', disabled.status === 'disabled', JSON.stringify(disabled))
  check('a disabled switch never starts the classifier', (await offscreenCount()) === 0)
  check('a disabled switch never fetches a classifier asset', classifierFetches(offFrom).length === 0)

  await run(SET_SWITCH(true))
  const malformedFrom = requests.length
  for (const [name, request] of MALFORMED) {
    const refused = await run(SUGGEST(request))
    check(
      `the background refuses ${name}`,
      refused.status === 'unavailable' && refused.error === 'invalid suggestion request',
      JSON.stringify(refused).slice(0, 200),
    )
  }
  const atLimit = { ...requestFor(ACCEPTED), optionLabels: Array.from({ length: 16 }, () => 'x'.repeat(4_096)) }
  check('malformed requests never start the classifier', (await offscreenCount()) === 0)
  check('malformed requests never fetch a classifier asset', classifierFetches(malformedFrom).length === 0)

  await run(BIND(harnessTab, harnessDestination, 'US'))
  await run('__attempts = 0')
  const started = Date.now()
  const coldPending = run(SUGGEST(requestFor(ACCEPTED)))
  await wait(300)
  const stoppedWith = await stopWorker()
  const cold = await coldPending
  report.push(`background cold suggestion, service worker stopped 300 ms in (${stoppedWith}): ${Date.now() - started} ms`)
  check('the service worker was stopped during the cold load', stoppedWith !== 'no worker running', stoppedWith)
  const attempts = await run('__attempts')
  check('the dropped request was retried once through the shipped client', attempts === 2, `attempts ${attempts}`)
  check('a suggestion survives the service worker stopping during the cold model load', matchesFixture(cold, ACCEPTED), JSON.stringify(cold))
  check('the bound job country reaches the classifier', cold.jobCountry === 'US', JSON.stringify(cold))
  check('the staged model version answers', cold.modelVersion === fixture.modelVersion, cold.modelVersion)
  check('with no saved answers the suggestion offers nothing to fill', cold.answer === null && cold.value === null)
  const status = await run(CALL('return await __status()'))
  check('the offscreen runtime reports a runtime identity', /^[0-9a-f]{64}$/.test(status.runtimeId), status.runtimeId)
  report.push(`runtime identity ${status.runtimeId}, ${status.labels} labels, load ${status.loadMs} ms`)

  const limitRequest = await run(SUGGEST(atLimit))
  check('a request exactly at the option-text limit is classified', ['classified', 'abstained'].includes(limitRequest.status), JSON.stringify(limitRequest).slice(0, 200))

  const options = await run(SUGGEST(requestFor(WITH_OPTIONS)))
  check('option labels reach the classifier and abstentions carry their reason', matchesFixture(options, WITH_OPTIONS), JSON.stringify(options))

  for (const [country, item] of [
    ['DE', COUNTRY_DE],
    ['GB', COUNTRY_GB],
  ]) {
    await run(BIND(harnessTab, harnessDestination, country))
    const result = await run(SUGGEST(requestFor(item)))
    check(`job country ${country} reaches the classifier exactly as python serialises it`, result.jobCountry === country && matchesFixture(result, item), JSON.stringify(result))
  }

  await run(UNBIND(harnessTab))
  const unknown = await run(SUGGEST(requestFor(ACCEPTED)))
  const unknownDirect = await run(CLASSIFY(requestFor(ACCEPTED), '_unknown'))
  check(
    'without a handoff the classifier receives _unknown',
    unknown.jobCountry === '_unknown' && matchesDecision(unknown, unknownDirect),
    JSON.stringify(unknown),
  )
  check('the _unknown decision differs from the US decision', !close(unknownDirect.calibratedConfidence, ACCEPTED.decision.calibratedConfidence))

  const closing = await run(
    CALL(`const requests = Array.from({ length: 128 }, (_, index) => ({ answerKind: 'text', input: { questionText: 'Describe the production incident you resolved ' + index, fieldType: 'TextArea', jobCountry: '_unknown', optionLabels: [] } }))
      const started = performance.now()
      const inflight = __classify(requests).then(() => 'answered', (error) => error.message)
      await new Promise((done) => setTimeout(done, 1500))
      await __closeClassifier()
      const outcome = await inflight
      return { outcome, ms: Math.round(performance.now() - started) }`),
  )
  await wait(1500)
  check('a deliberate close resolves the in-flight request at once', closing.outcome === 'the classifier was closed' && closing.ms < 5_000, JSON.stringify(closing))
  check('a deliberate close is not retried', (await offscreenCount()) === 0)

  await run(SET_SWITCH(false))
  await waitFor(offscreenCount, (count) => count === 0, 10_000, 'the offscreen document to close')
  await run(SET_SWITCH(true))
  await run(SUGGEST(requestFor(ACCEPTED)))
  check('the model is running before the switch turns off', (await offscreenCount()) === 1)
  await run(SET_SWITCH(false))
  await waitFor(offscreenCount, (count) => count === 0, 10_000, 'the offscreen document to close')
  check('turning the switch off closes the model process', (await offscreenCount()) === 0)

  await run(BIND(harnessTab, harnessDestination, 'US'))
  await rename(modelPath, `${modelPath}.away`)
  await run(SET_SWITCH(true))
  const broken = await run(SUGGEST(requestFor(ACCEPTED)))
  check('a failed model load answers unavailable', broken.status === 'unavailable', JSON.stringify(broken))
  check('the offscreen document stays open after the failed load', (await offscreenCount()) === 1)
  await rename(`${modelPath}.away`, modelPath)
  const recovered = await run(SUGGEST(requestFor(ACCEPTED)))
  check('the next request after a failed model load recovers', matchesFixture(recovered, ACCEPTED), JSON.stringify(recovered))
  report.push(`model load failure answered: ${broken.error}`)

  await run(SET_SWITCH(false))
  await waitFor(offscreenCount, (count) => count === 0, 10_000, 'the offscreen document to close')
  await run(SET_SWITCH(true))
  const racing = run(SUGGEST(requestFor(ACCEPTED)))
  await wait(300)
  await run(SET_SWITCH(false))
  const raced = await racing
  check('a request running when the switch turns off answers disabled', raced.status === 'disabled', JSON.stringify(raced))
  await waitFor(offscreenCount, (count) => count === 0, 10_000, 'the offscreen document to close')
  check('a request running when the switch turns off leaves no model process', (await offscreenCount()) === 0)
  const off = await run(SUGGEST(requestFor(ACCEPTED)))
  check('turning the switch off stops suggestions again', off.status === 'disabled', JSON.stringify(off))
  report.push(`accepted ${cold.label}@${cold.confidence.toFixed(3)}; abstained ${options.topLabel}@${options.confidence.toFixed(3)}:${options.reason}`)

  const site = await browser.send('Target.createTarget', { url: 'about:blank' })
  const siteSession = await attach(site.targetId)
  await browser.send('Page.navigate', { url: `${SITE}/job` }, siteSession)
  await waitFor(
    () => evaluate(browser, siteSession, `typeof __handoff === 'function' && typeof chrome?.runtime?.sendMessage === 'function'`, 5_000),
    Boolean,
    20_000,
    'the handoff page',
  )

  const fieldsReady = (atsSession) =>
    waitFor(
      () => evaluate(browser, atsSession, `document.querySelectorAll('[data-tp-field-widget]').length`, 5_000),
      (count) => count === FIELDS.length,
      30_000,
      'the adapter to register every field',
    )

  let opened = 0
  const handoff = async (country, raw = false) => {
    opened += 1
    const destination = `${ATS}/smoke/jobs/${opened}?source=talentprofile`
    const applicationId = `smoke-application-${opened}`
    const call = raw ? '__rawHandoff' : '__handoff'
    const sent = await evaluate(
      browser,
      siteSession,
      `${call}(${JSON.stringify(extensionId)}, ${JSON.stringify(applicationId)}, ${JSON.stringify(destination)}, ${JSON.stringify(country)})`,
      10_000,
    )
    check(`the extension accepted the ${raw ? 'raw ' : ''}handoff for ${JSON.stringify(country)}`, sent.response?.ok === true, JSON.stringify(sent))
    await browser.send('Page.bringToFront', {}, siteSession)
    await evaluate(browser, siteSession, `window.open(${JSON.stringify(destination)}, '_blank'); true`, 5_000, { userGesture: true })
    const target = await waitFor(
      async () => (await browser.send('Target.getTargets')).targetInfos.find((info) => info.url === destination),
      Boolean,
      20_000,
      `the application tab for ${destination}`,
    )
    const atsSession = await attach(target.targetId)
    await browser.send('Page.enable', {}, atsSession)
    await browser.send('Runtime.enable', {}, atsSession)
    const atsTabId = await waitFor(
      () => run(CALL(`return (await chrome.tabs.query({ url: ${JSON.stringify(destination)} }))[0]?.id ?? null`)),
      (id) => id !== null,
      20_000,
      'the application tab id',
    )
    await fieldsReady(atsSession)
    const context = await run(BOUND_CONTEXT(atsTabId))
    return { atsSession, atsTabId, context, destination, sent: sent.sent, targetId: target.targetId }
  }

  const uk = await handoff('UK')
  check('the public website sends UK as GB', uk.sent === 'GB', JSON.stringify(uk.sent))
  check('the application tab is bound to GB', uk.context?.jobCountry === 'GB' && uk.context?.destinationUrl === uk.destination, JSON.stringify(uk.context))
  const germany = await handoff('Germany')
  check('the application tab is bound to DE for Germany', germany.sent === 'DE' && germany.context?.jobCountry === 'DE', JSON.stringify(germany.context))
  const missing = await handoff(null)
  check('a job without a country is sent as null and binds _unknown', missing.sent === null && missing.context?.jobCountry === '_unknown', JSON.stringify(missing.context))
  const rawUk = await handoff('UK', true)
  check('the extension refuses a non-ISO country and binds _unknown', rawUk.context?.jobCountry === '_unknown', JSON.stringify(rawUk.context))
  report.push(`handoff bindings: UK->${uk.context?.jobCountry}, Germany->${germany.context?.jobCountry}, none->${missing.context?.jobCountry}, raw UK->${rawUk.context?.jobCountry}`)

  const pageRequest = async (atsSession, request) => {
    await browser.send('Page.bringToFront', {}, atsSession)
    return evaluate(browser, atsSession, PAGE_BRIDGE_REQUEST(request), 160_000)
  }

  const offRow = await pageRequest(uk.atsSession, requestFor(PAGE_ACCEPTED))
  check('with the switch off the page bridge answers no row', offRow.result?.row === null, JSON.stringify(offRow.result))
  check('with the switch off a page request never starts the classifier', (await offscreenCount()) === 0)

  await run(SET_SWITCH(true))
  for (const [name, request] of MALFORMED) {
    const refused = await pageRequest(uk.atsSession, request)
    check(`the page bridge answers no row for ${name}`, refused.result?.row === null, JSON.stringify(refused.result))
  }
  check('malformed page requests never start the classifier', (await offscreenCount()) === 0)

  for (const [name, item] of [
    ['an accepted label without a saved answer', PAGE_ACCEPTED],
    ['an abstention', PAGE_ABSTAINED],
  ]) {
    await run(BIND(harnessTab, harnessDestination, item.input.jobCountry))
    const full = JSON.stringify(await run(SUGGEST(requestFor(item))))
    check(`${name}: the background result holds the details the page must not see`, secretsOf(item).every((secret) => full.includes(secret)), full)
    await run(BIND(uk.atsTabId, uk.destination, item.input.jobCountry))
    const answered = await pageRequest(uk.atsSession, requestFor(item))
    check(`${name} crosses into the page as no row`, answered.result?.row === null, JSON.stringify(answered.result))
    const visible = exposure(answered.seen, item)
    check(`${name} puts no classifier detail on the page`, visible.length === 0, visible.join(', '))
  }
  check('page requests ran the classifier', (await offscreenCount()) === 1)

  const clickCenter = async (atsSession, expression) => {
    const box = await evaluate(browser, atsSession, expression, 5_000)
    if (!box) throw new Error(`nothing to click: ${expression}`)
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await browser.send(
        'Input.dispatchMouseEvent',
        { button: 'left', clickCount: 1, type, x: box.x + box.width / 2, y: box.y + box.height / 2 },
        atsSession,
      )
    }
  }
  const iconBox = (field) =>
    `(() => { const r = document.querySelector('#${field} [data-tp-field-widget]')?.shadowRoot?.querySelector('button')?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null })()`
  const rowBox = `(() => { const r = ${PICKER}?.querySelector('[data-tp-suggestion]')?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null })()`
  const pickerState = (atsSession) => evaluate(browser, atsSession, PICKER_STATE, 5_000)
  const openPicker = async (atsSession, field) => {
    await browser.send('Page.bringToFront', {}, atsSession)
    if ((await pickerState(atsSession)).open) {
      await clickCenter(atsSession, `({ x: 1, y: 1, width: 2, height: 2 })`)
      await waitFor(() => pickerState(atsSession), (state) => !state.open, 5_000, 'the previous picker to close')
    }
    await evaluate(browser, atsSession, RECORD_BRIDGE, 5_000)
    await clickCenter(atsSession, iconBox(field))
    return waitFor(() => pickerState(atsSession), (state) => state.open, 10_000, 'the picker to open')
  }
  const settled = (atsSession) =>
    waitFor(
      () => pickerState(atsSession),
      (state) => state.list && state.items > 0 && state.results >= 1,
      160_000,
      'the signed-in picker and its suggestion answer',
    )

  const isolatedWorld = async (atsSession) => {
    const frameId = (await browser.send('Page.getFrameTree', {}, atsSession)).frameTree.frame.id
    return waitFor(
      async () =>
        (contexts.get(atsSession) ?? []).filter(
          (context) =>
            context.auxData?.frameId === frameId &&
            context.auxData?.type === 'isolated' &&
            (context.origin === extensionOrigin || context.name === EXTENSION_NAME),
        ).at(-1)?.id ?? null,
      (id) => id !== null,
      20_000,
      'the content script world',
    )
  }
  const inContentScript = async (atsSession, expression) => {
    await browser.send('Page.bringToFront', {}, atsSession)
    return evaluate(browser, atsSession, expression, 160_000, { contextId: await isolatedWorld(atsSession) })
  }
  const contentSuggest = (atsSession, request) =>
    inContentScript(atsSession, CALL(`return (await chrome.runtime.sendMessage({ kind: 'classifier.suggest', request: ${JSON.stringify(request)} })).data`))

  const signedOut = await openPicker(uk.atsSession, 'f-first')
  const signIn = await waitFor(() => pickerState(uk.atsSession), (state) => state.signIn, 10_000, 'the signed-out picker')
  check('the real picker opens from the field icon', signedOut.open)
  check('a signed-out picker offers no suggestion row', signIn.rows.length === 0, JSON.stringify(signIn.rows))
  check('a signed-out picker never asks for a suggestion', signIn.results === 0, String(signIn.results))

  const linkedLabel = PAGE_ACCEPTED.decision.labelEnumId
  let linkedQuestion = null
  for (const question of LINKED_CANDIDATES) {
    const decision = await run(CLASSIFY({ answerKind: 'text', fieldType: 'TextInput', optionLabels: [], questionText: question }, '_unknown'))
    if (decision.labelEnumId === linkedLabel) {
      linkedQuestion = question
      break
    }
  }
  check('a stored question links to the accepted field label', linkedQuestion !== null, LINKED_CANDIDATES.join(' / '))
  const now = new Date().toISOString()
  const answer = async (id, questionText, value) => ({
    answerKind: 'text',
    answerText: value,
    answerValue: { confidence: 'exact', kind: 'string', value },
    ats: 'greenhouseReact',
    createdAt: now,
    fieldType: 'TextInput',
    id,
    labelEnumId: null,
    lastUsedAt: null,
    normalizedQuestion: await run(`__normalizeQuestion(${JSON.stringify(questionText)})`),
    pageUrl: null,
    profileField: null,
    questionText,
    resolverOutcome: 'filled',
    section: null,
    source: 'manual',
    sourceAnswerId: null,
    talentJobApplicationId: null,
    talentProfileId: PROFILE.id,
    updatedAt: now,
  })
  const answers = [
    await answer('smoke-linked', linkedQuestion, LINKED_VALUE),
    await answer('smoke-exact', EXACT_QUESTION, EXACT_VALUE),
    await answer('smoke-overlap', OVERLAP_STORED, OVERLAP_VALUE),
  ]
  const seed = () =>
    run(
      CALL(`await chrome.storage.local.set({ '${TOKENS_KEY}': ${JSON.stringify(TOKENS)} })
        await chrome.storage.session.set({ '${PROFILE_KEY}': { data: ${JSON.stringify({ ...PROFILE, talentAnswers: answers })}, fetchedAt: Date.now() } })
        return true`),
    )
  const signedInFrom = requests.length

  await run(SET_SWITCH(false))
  await waitFor(offscreenCount, (count) => count === 0, 10_000, 'the offscreen document to close')
  await seed()
  await run(BIND(uk.atsTabId, uk.destination, PAGE_ACCEPTED.input.jobCountry))
  await inContentScript(uk.atsSession, COUNT_SUGGEST_SENDS)
  const signedOffFrom = requests.length
  await openPicker(uk.atsSession, 'f-first')
  const signedInOff = await settled(uk.atsSession)
  check('signed in with the switch off: no row', signedInOff.rows.length === 0, JSON.stringify(signedInOff.rows))
  check('signed in with the switch off: no background suggestion request', (await inContentScript(uk.atsSession, 'globalThis.__suggestSends')) === 0)
  check('signed in with the switch off: no model process', (await offscreenCount()) === 0)
  check('signed in with the switch off: no classifier asset fetch', classifierFetches(signedOffFrom).length === 0, JSON.stringify(classifierFetches(signedOffFrom)))

  await run(SET_SWITCH(true))
  for (const [name, field, value] of [
    ['an exact question match', 'f-exact', EXACT_VALUE],
    ['a word-overlap match', 'f-overlap', OVERLAP_VALUE],
  ]) {
    await seed()
    const from = requests.length
    await openPicker(uk.atsSession, field)
    const state = await settled(uk.atsSession)
    check(`${name} shows its saved answer`, state.rows.length === 1 && state.rows[0].title === value, JSON.stringify(state.rows))
    check(`${name} never starts the model`, (await offscreenCount()) === 0)
    check(`${name} fetches no classifier asset`, classifierFetches(from).length === 0, JSON.stringify(classifierFetches(from)))
  }

  await seed()
  await inContentScript(uk.atsSession, COUNT_SUGGEST_SENDS)
  const coldStarted = Date.now()
  await openPicker(uk.atsSession, 'f-first')
  await waitFor(() => inContentScript(uk.atsSession, 'globalThis.__suggestSends'), (sends) => sends >= 1, 20_000, 'the picker suggestion request')
  await wait(300)
  const pickerStopped = await stopWorker()
  const shown = await settled(uk.atsSession)
  const pickerSends = await inContentScript(uk.atsSession, 'globalThis.__suggestSends')
  report.push(`picker cold suggestion, service worker stopped 300 ms after the request (${pickerStopped}): ${Date.now() - coldStarted} ms, ${pickerSends} sends`)
  check('the service worker was stopped during the picker cold load', pickerStopped !== 'no worker running', pickerStopped)
  check('the picker request was retried exactly once', pickerSends === 2, `sends ${pickerSends}`)
  check('an accepted label with a saved answer shows exactly one row', shown.rows.length === 1, JSON.stringify(shown.rows))
  check(
    'the row holds only the saved answer and Suggested answer',
    shown.rows[0]?.title === LINKED_VALUE &&
      shown.rows[0]?.badge === 'Suggested answer' &&
      shown.rows[0]?.spans === 2 &&
      shown.rows[0]?.compact === `${LINKED_VALUE}Suggested answer`.replace(/\s+/g, ''),
    JSON.stringify(shown.rows[0]),
  )
  const rowLeaks = secretsOf(PAGE_ACCEPTED)
    .filter((secret) => (shown.rows[0]?.html ?? '').includes(secret))
    .concat(exposure(shown.seen, PAGE_ACCEPTED))
  check('the row and the page bridge carry no classifier detail', rowLeaks.length === 0, rowLeaks.join(', '))
  await clickCenter(uk.atsSession, rowBox)
  const filled = await waitFor(
    () => evaluate(browser, uk.atsSession, `document.querySelector('#first').value`, 5_000),
    (value) => value === LINKED_VALUE,
    10_000,
    'the field to fill',
  )
  check('clicking the row fills the real field', filled === LINKED_VALUE, filled)
  const closedAfterFill = await waitFor(() => pickerState(uk.atsSession), (state) => !state.open, 10_000, 'the picker to close after the fill')
  check('clicking the row closes the picker', !closedAfterFill.open)

  for (const [name, field, item] of [
    ['an abstention', 'f-links', PAGE_ABSTAINED],
    ['an accepted label without a saved answer', 'f-portfolio', PAGE_NO_ANSWER],
  ]) {
    await seed()
    await run(BIND(uk.atsTabId, uk.destination, item.input.jobCountry))
    await openPicker(uk.atsSession, field)
    const state = await settled(uk.atsSession)
    check(`signed in, ${name} shows no row`, state.rows.length === 0, JSON.stringify(state.rows))
    const visible = exposure(state.seen, item)
    check(`signed in, ${name} puts no classifier detail on the page`, visible.length === 0, visible.join(', '))
  }

  await seed()
  await run(BIND(uk.atsTabId, uk.destination, PAGE_ACCEPTED.input.jobCountry))
  const cache = await run(CALL(`return (await chrome.storage.session.get('${ANSWER_LABELS_KEY}'))['${ANSWER_LABELS_KEY}']`))
  check(
    'the stored-answer cache is keyed by runtime identity, revision and input',
    cache?.runtimeId === status.runtimeId &&
      cache.entries?.['smoke-linked']?.revision === now &&
      cache.entries['smoke-linked'].labelEnumId === linkedLabel &&
      typeof cache.entries['smoke-linked'].input === 'string',
    JSON.stringify(cache).slice(0, 400),
  )
  await run(CALL(`window.__labelWrites = 0
    if (!window.__labelWatcher) {
      window.__labelWatcher = (changes, area) => { if (area === 'session' && changes['${ANSWER_LABELS_KEY}']) window.__labelWrites += 1 }
      chrome.storage.onChanged.addListener(window.__labelWatcher)
    }
    return true`))
  await openPicker(uk.atsSession, 'f-first')
  const reopened = await settled(uk.atsSession)
  check('reopening the picker shows the row again', reopened.rows.length === 1 && reopened.rows[0].title === LINKED_VALUE, JSON.stringify(reopened.rows))
  check('reopening reuses the stored-answer labels without reclassifying', (await run('window.__labelWrites')) === 0)

  const storedTokens = await run(CALL(`return (await chrome.storage.local.get('${TOKENS_KEY}'))['${TOKENS_KEY}']`))
  check('the synthetic tokens were never refreshed', JSON.stringify(storedTokens) === JSON.stringify(TOKENS))
  const backend = requests.slice(signedInFrom).filter((request) => /^https?:/.test(request.url) && !request.url.startsWith(ATS))
  check('signed in, no token refresh, profile fetch or backend request was made', backend.length === 0, JSON.stringify(backend))

  await run(BIND(germany.atsTabId, germany.destination, 'DE'))
  const beforeMove = await contentSuggest(germany.atsSession, requestFor(COUNTRY_DE))
  check('the bound tab sends its job country from the content script', beforeMove.jobCountry === 'DE' && matchesFixture(beforeMove, COUNTRY_DE), JSON.stringify(beforeMove))
  await browser.send('Page.navigate', { url: `${germany.destination}#questions` }, germany.atsSession)
  await wait(1000)
  check('a fragment-only change keeps the context', (await run(BOUND_CONTEXT(germany.atsTabId)))?.jobCountry === 'DE')
  await evaluate(browser, germany.atsSession, `history.pushState({}, '', '/smoke/jobs/2/other?source=talentprofile'); true`, 5_000)
  await waitFor(() => run(BOUND_CONTEXT(germany.atsTabId)), (context) => context === null, 10_000, 'the history navigation to clear the context')
  check('a History API navigation clears application id and country', (await run(BOUND_CONTEXT(germany.atsTabId))) === null)

  await run(BIND(uk.atsTabId, uk.destination, 'GB'))
  const onJob = await contentSuggest(uk.atsSession, requestFor(COUNTRY_GB))
  check('the first job sends GB from its tab', onJob.jobCountry === 'GB' && matchesFixture(onJob, COUNTRY_GB), JSON.stringify(onJob))
  const secondJob = `${ATS}/smoke/jobs/second?source=talentprofile`
  await browser.send('Page.navigate', { url: secondJob }, uk.atsSession)
  await fieldsReady(uk.atsSession)
  await waitFor(() => run(BOUND_CONTEXT(uk.atsTabId)), (context) => context === null, 10_000, 'the second job to clear the context')
  check('opening a second job in the same tab clears application id and country', (await run(BOUND_CONTEXT(uk.atsTabId))) === null)
  const onSecondJob = await contentSuggest(uk.atsSession, requestFor(COUNTRY_GB))
  const secondDirect = await run(CLASSIFY(requestFor(COUNTRY_GB), '_unknown'))
  check(
    'the second job reaches the classifier as _unknown',
    onSecondJob.jobCountry === '_unknown' && matchesDecision(onSecondJob, secondDirect),
    JSON.stringify(onSecondJob),
  )
  check('the second job decision differs from the GB decision', !close(secondDirect.calibratedConfidence, COUNTRY_GB.decision.calibratedConfidence))

  check(
    'the network recorder captures page requests',
    requests.some((request) => request.url.startsWith(ATS)) && requests.some((request) => request.url.startsWith(SITE)),
  )
  const external = requests.filter((request) => /^https?:/.test(request.url) && !request.url.startsWith(SITE) && !request.url.startsWith(ATS))
  check('no request left the served test pages during the whole run', external.length === 0, JSON.stringify(external))
  check('every served page request was answered locally', intercepted.every((url) => url.startsWith(SITE) || url.startsWith(ATS)), intercepted.join(', '))
  report.push(`network: ${requests.length} requests recorded, ${intercepted.length} page requests served locally, ${external.length} external`)
  browser.close()
} catch (error) {
  failure = error
} finally {
  stopResuming()
  chrome.kill('SIGKILL')
  await wait(500)
  await rm(profile, { recursive: true, force: true })
  await rm(workDir, { recursive: true, force: true })
}

const leftovers = [profile, workDir].filter((path) => existsSync(path))
console.log(report.join('\n'))
console.log(checks.map((item) => `${item.ok ? 'ok  ' : 'FAIL'} ${item.name}`).join('\n'))
if (leftovers.length) console.log(`FAIL temporary directories left behind: ${leftovers.join(', ')}`)
if (failure || leftovers.length) {
  if (failure) console.error(`FAILED: ${failure.message}`)
  process.exit(1)
}
console.log(`temporary Chrome profile removed: ${profile}`)
console.log(`suggestion smoke passed: ${checks.length} checks`)

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { cp, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
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
const API = 'https://backend.talentprofile.net'
const WORKDAY = 'https://smoke.wd5.myworkdayjobs.com'
const CLASSIC = 'https://boards.greenhouse.io'
const EXTENSION_NAME = 'TalentProfile Autofill'
const BRIDGE_MAGIC = 'tp:bridge'
const SWITCH_KEY = 'tp.classifierSuggestions'
const ANSWER_LABELS_KEY = 'tp.classifier.answerLabels'
const TOKENS_KEY = 'tp.tokens'
const PROFILE_KEY = 'tp.profileCache'

const wait = (ms) => new Promise((done) => setTimeout(done, ms))

async function extensionIdOf(directory) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
  const identity = manifest.key ? Buffer.from(manifest.key, 'base64') : await realpath(directory)
  return [...createHash('sha256').update(identity).digest('hex').slice(0, 32)]
    .map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)))
    .join('')
}

async function requireExtensionApis(session, sessionId, targetId) {
  const page = await evaluate(
    session,
    sessionId,
    `({ href: location.href, runtime: typeof globalThis.chrome?.runtime, tabs: typeof globalThis.chrome?.tabs })`,
    10_000,
  )
  if (page.runtime !== 'object' || page.tabs !== 'object') {
    throw new Error(`the harness page has no extension APIs: ${JSON.stringify({ targetId, ...page })}`)
  }
}

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
const LINKED_STORED_COUNTRY = 'DE'
const EXACT_VALUE = 'Smoke Exact Answer'
const OVERLAP_VALUE = 'Smoke Overlap Answer'
const NOTE_SENTINEL = 'TP-PRIVATE-NOTE-SENTINEL-9c2f6a'
const NOTE = {
  content: NOTE_SENTINEL,
  createdAt: '2026-09-01T00:00:00.000Z',
  id: 'smoke-note',
  lastUsedAt: null,
  updatedAt: '2026-09-01T00:00:00.000Z',
}

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
import { isCountryScopedQuestion } from '${resolve(root, 'src/resolver/countryScopedAnswers.ts')}'

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
globalThis.__isCountryScoped = isCountryScopedQuestion
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

const NATIVE_COUNTERS = `<script>
window.__nativeClicks = 0
window.__submits = 0
for (const control of document.querySelectorAll('button, input[type=submit]')) control.addEventListener('click', () => { window.__nativeClicks += 1 })
for (const form of document.querySelectorAll('form')) form.addEventListener('submit', (event) => { event.preventDefault(); window.__submits += 1 })
</script>`

const ATS_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Apply</title>
<style>body{font:14px sans-serif;margin:24px}.field{position:relative;width:420px;margin:0 0 28px}input{width:360px;padding:6px}</style>
</head><body>
<div class="application--container">
  <div jaf-section="personal">
${FIELDS.map(([wrapper, input, label]) => `    <div class="field" id="${wrapper}"><div class="text-input-wrapper"><label for="${input}">${label}</label><input id="${input}" type="text"></div></div>`).join('\n')}
  </div>
  <div class="actions" style="display:flex;gap:8px"><button type="button" id="attach-resume">Attach</button><button type="submit" id="submit-application">Submit application</button></div>
</div>
${NATIVE_COUNTERS}
</body></html>`

const CLASSIC_FIELDS = [
  ['c-first', 'First Name'],
  ['c-last', 'Last Name'],
  ['c-email', 'Email'],
]

const frameField = (id, label) =>
  `<div class="field"><div class="text-input-wrapper"><label for="${id}">${label}</label><input id="${id}" type="text"></div></div>`

const FRAMES_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Apply</title>
<style>body{font:14px sans-serif;margin:24px}input{width:360px;padding:6px}iframe{display:block;width:600px;height:160px;border:0;margin-top:24px}</style>
</head><body>
<div class="application--container"><div jaf-section="personal">
  ${frameField('top-first', 'First Name')}
</div></div>
<iframe id="inner" src="/smoke/inner"></iframe>
</body></html>`

const INNER_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Inner</title><style>body{font:14px sans-serif;margin:8px}input{width:360px;padding:6px}</style></head><body>
<div class="application--container"><div jaf-section="personal">
  ${frameField('inner-first', 'Last Name')}
</div></div>
</body></html>`

const CLASSIC_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Apply</title>
<style>body{font:14px sans-serif;margin:24px}.field{position:relative;width:420px;margin:0 0 28px}input[type=text]{width:360px;padding:6px}</style>
</head><body>
<div id="application"><form id="application_form" action="/smoke/submitted" method="post">
${CLASSIC_FIELDS.map(([input, label]) => `  <div class="field"><label for="${input}">${label}</label><input id="${input}" type="text"></div>`).join('\n')}
  <div class="actions" style="display:flex;gap:8px"><button type="button" id="attach-resume">Attach</button><input type="submit" id="submit_app" value="Submit Application"></div>
</form></div>
${NATIVE_COUNTERS}
</body></html>`

const WORKDAY_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Sign In</title>
<style>body{font:14px sans-serif;margin:0}main{display:flex;justify-content:center;padding:40px}form{width:376px}input{display:block;width:376px;height:40px;box-sizing:border-box}.wrap{position:relative;display:inline-block;width:376px;height:40px}.filter{position:absolute;inset:0;z-index:3;background:transparent}button{display:inline-block;width:376px;height:40px}</style>
</head><body>
<main><div data-automation-id="applyFlowPage">
<form data-automation-id="signInFormo">
  <div data-automation-id="formField-email"><label><span>Email Address</span><abbr>*</abbr></label><div><div><input data-automation-id="email" type="text"></div><div></div></div></div>
  <div><div data-automation-id="formField-password"><label><span>Password</span><abbr>*</abbr></label><div><div><input data-automation-id="password" type="password"></div><div></div></div></div></div>
  <div class="wrap"><div class="wrap"><div data-automation-id="noCaptchaWrapper" class="wrap"><div class="wrap"><div class="wrap"><div data-automation-id="click_filter" role="button" aria-label="Submit" tabindex="0" class="filter"></div><button data-automation-id="signInSubmitButton" type="submit" tabindex="-2">Sign In</button></div></div></div></div></div>
</form>
</div></main>
<script>
window.__nativeClicks = 0
window.__submits = 0
document.querySelector('[data-automation-id=click_filter]').addEventListener('click', () => { window.__nativeClicks += 1 })
document.querySelector('[data-automation-id=signInSubmitButton]').addEventListener('click', () => { window.__nativeClicks += 1 })
document.querySelector('form').addEventListener('submit', (event) => { event.preventDefault(); window.__submits += 1 })
</script>
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

const CDP_NOT_READY = /wasn't found|No session with given id|Session with given id not found|No target with given id|Target closed|Cannot find context with specified id|Execution context was destroyed|Inspected target navigated or closed|Cannot find default execution context/
const cdpNotReady = (error) => CDP_NOT_READY.test(error instanceof Error ? error.message : String(error))

async function evaluate(session, sessionId, expression, timeoutMs = TIMEOUT_MS, extra = {}) {
  let timer
  const result = await Promise.race([
    session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...extra }, sessionId),
    new Promise((_, fail) => {
      timer = setTimeout(() => fail(new Error(`evaluation timed out after ${timeoutMs} ms`)), timeoutMs)
    }),
  ]).finally(() => clearTimeout(timer))
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
const SET_SWITCH = (value) => CALL(`await chrome.storage.local.set({ '${SWITCH_KEY}': ${JSON.stringify(value)} })`)
const CLEAR_SWITCH = CALL(`await chrome.storage.local.remove('${SWITCH_KEY}')`)
const SWITCH_STORED = CALL(`return '${SWITCH_KEY}' in (await chrome.storage.local.get('${SWITCH_KEY}'))`)
const BIND = (tabId, destinationUrl, country) =>
  CALL(`await chrome.storage.session.set({ 'tp.applicationContext.tab.${tabId}': { applicationId: 'smoke', destinationUrl: ${JSON.stringify(destinationUrl)}, jobCountry: ${JSON.stringify(country)} } })
    return true`)
const UNBIND = (tabId) => CALL(`await chrome.storage.session.remove('tp.applicationContext.tab.${tabId}')`)
const BOUND_CONTEXT = (tabId) =>
  CALL(`const key = 'tp.applicationContext.tab.${tabId}'
    return (await chrome.storage.session.get(key))[key] ?? null`)
const HARNESS_TAB = CALL(`return (await chrome.tabs.getCurrent()).id`)

const FORGE_BRIDGE = (payloads, clicks, waitMs) =>
  CALL(`const replies = []
    const listener = (event) => {
      if (event.data?.magic === '${BRIDGE_MAGIC}' && event.data.from === 'content') replies.push(JSON.stringify(event.data.payload))
    }
    addEventListener('message', listener)
    for (const payload of ${JSON.stringify(payloads)}) {
      postMessage({ magic: '${BRIDGE_MAGIC}', from: 'main', payload }, location.origin)
    }
    const clicked = {}
    for (const [name, selector] of ${JSON.stringify(clicks)}) {
      const [host, inner] = selector
      const button = document.querySelector(host)?.shadowRoot?.querySelector(inner)
      clicked[name] = Boolean(button)
      button?.click()
    }
    await new Promise((done) => setTimeout(done, ${waitMs}))
    removeEventListener('message', listener)
    return { clicked, replies }`)

const RECORD_BRIDGE = CALL(`window.__bridgeSeen = []
    if (!window.__bridgeRecorder) {
      window.__bridgeRecorder = (event) => {
        if (event.data?.magic !== '${BRIDGE_MAGIC}') return
        window.__bridgeSeen.push(JSON.stringify(event.data))
      }
      addEventListener('message', window.__bridgeRecorder)
    }
    return true`)

const PICKER_HOOK = `if (location.protocol === 'chrome-extension:' && !globalThis.__tpPickerHook) {
  globalThis.__tpPickerHook = true
  globalThis.__tpPulse = { last: Date.now(), gaps: [], moves: [] }
  setInterval(() => {
    const now = Date.now()
    if (now - __tpPulse.last > 50) __tpPulse.gaps.push({ at: now, gap: now - __tpPulse.last })
    __tpPulse.last = now
  }, 16)
  addEventListener('pointermove', (event) => { if (event.isTrusted) __tpPulse.moves.push(Date.now()) }, true)
  globalThis.__suggestSends = 0
  globalThis.__suggestDone = 0
  globalThis.__suggestGeneration = 0
  globalThis.__suggestResults = []
  const watchActivation = () =>
    new MutationObserver(() => {
      if (document.documentElement.getAttribute('data-tp-active') === 'true') return
      globalThis.__suggestGeneration += 1
      globalThis.__suggestSends = 0
      globalThis.__suggestDone = 0
    }).observe(document.documentElement, { attributeFilter: ['data-tp-active'], attributes: true })
  if (document.documentElement) watchActivation()
  else document.addEventListener('DOMContentLoaded', watchActivation, { once: true })
  const runtime = chrome.runtime
  const original = runtime.sendMessage.bind(runtime)
  runtime.sendMessage = (...args) => {
    const suggest = args[0]?.kind === 'classifier.suggest'
    const generation = globalThis.__suggestGeneration
    if (suggest) globalThis.__suggestSends += 1
    const result = original(...args)
    if (suggest) Promise.resolve(result).then(
      (value) => { globalThis.__suggestResults.push(JSON.stringify(value).slice(0, 600)) },
      (error) => { globalThis.__suggestResults.push('rejected: ' + String(error)) },
    ).then(() => {
      if (generation === globalThis.__suggestGeneration) globalThis.__suggestDone += 1
    })
    return result
  }
}`
const RECT = (selector) =>
  `(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null })()`
const NOTE_ROW = (id) => RECT(`[data-tp-item-id="${id}"] button.item`)
const NOTE_LEAF = CALL(`const row = document.querySelector('[data-tp-item-id="nt.${NOTE.id}"]')
    return row ? { kind: row.getAttribute('data-tp-item-kind'), text: row.textContent } : null`)
const RECORD_CLASSIFIER_POSTS = CALL(`globalThis.__classifierPosts = []
    if (!globalThis.__classifierRecorder) {
      globalThis.__classifierRecorder = true
      const runtime = chrome.runtime
      const connect = runtime.connect.bind(runtime)
      runtime.connect = (...args) => {
        const port = connect(...args)
        const post = port.postMessage.bind(port)
        port.postMessage = (message) => {
          globalThis.__classifierPosts.push(JSON.stringify(message))
          return post(message)
        }
        return port
      }
    }
    return true`)
const PICKER_STATE = CALL(`const rows = [...document.querySelectorAll('[data-tp-suggestion]')]
    return {
      sends: globalThis.__suggestSends ?? -1,
      done: globalThis.__suggestDone ?? -1,
      generation: globalThis.__suggestGeneration ?? -1,
      results: (globalThis.__suggestResults ?? []).slice(-3),
      open: true,
      title: document.querySelector('.title')?.textContent?.trim() ?? null,
      signIn: Boolean(document.querySelector('.signin')),
      list: Boolean(document.querySelector('.list')),
      empty: document.querySelector('.list .empty')?.textContent?.trim() ?? null,
      items: document.querySelectorAll('.list .item-wrap').length,
      rows: rows.map((row) => ({
        badge: row.querySelector('.value')?.textContent?.trim() ?? null,
        compact: row.textContent.replace(/\\s+/g, ''),
        html: row.outerHTML,
        spans: row.querySelectorAll('span').length,
        title: row.querySelector('.label-text')?.textContent?.trim() ?? null,
      })),
    }`)

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
const extensionId = await extensionIdOf(extension)
const workerUrl = `chrome-extension://${extensionId}/background.js`
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
    ...(process.env.CHROME_SMOKE_LOG ? ['--enable-logging=stderr'] : []),
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', process.env.CHROME_SMOKE_LOG ? 'pipe' : 'ignore'] },
)
if (process.env.CHROME_SMOKE_LOG) chrome.stderr.pipe(createWriteStream(process.env.CHROME_SMOKE_LOG))

const report = []
let failure = null
const crashed = []
const collateralCrashes = (from = 0) => crashed.slice(from).filter((entry) => entry.type !== 'service_worker')
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
  const pickerParents = new Map()
  const sessionTypes = new Map()
  const requests = []
  const intercepted = []
  const apiCalls = []
  const apiState = { answers: [], notes: [], profile: null }
  const contexts = new Map()
  const workerStates = []
  const sessionReady = new Map()
  const targetLog = new Map()
  const setupRetries = []
  const setupErrors = []

  browser.on(async (message) => {
    if (message.method === 'Inspector.targetCrashed') {
      crashed.push({ session: message.sessionId ?? 'root', type: sessionTypes.get(message.sessionId) ?? 'unknown' })
      return
    }
    if (message.method === 'ServiceWorker.workerVersionUpdated') {
      for (const version of message.params.versions) {
        if (version.scriptURL === workerUrl) workerStates.push({ id: version.versionId, status: version.runningStatus })
      }
      return
    }
    if (message.method === 'Network.requestWillBeSent') {
      requests.push({
        postData: message.params.request.postData ?? null,
        type: sessionTypes.get(message.sessionId) ?? 'unknown',
        url: message.params.request.url,
      })
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
    if (message.method === 'Fetch.requestPaused' && message.params.request.url.startsWith(API)) {
      const { requestId, request } = message.params
      const url = new URL(request.url)
      apiCalls.push({ method: request.method, postData: request.postData ?? null, url: request.url })
      const route = `${request.method} ${url.pathname}`
      const body =
        route === 'GET /api/v1/talentprofile/first'
          ? apiState.profile
          : route === 'GET /api/v1/talentanswer'
            ? apiState.answers
            : route === 'GET /api/v1/talentnote'
              ? apiState.notes
              : route === 'PUT /api/v1/talentnote'
                ? { ...apiState.notes[0], lastUsedAt: new Date().toISOString() }
                : null
      try {
        if (body === null) {
          await browser.send('Fetch.failRequest', { errorReason: 'BlockedByClient', requestId }, message.sessionId)
        } else {
          await browser.send(
            'Fetch.fulfillRequest',
            {
              body: Buffer.from(JSON.stringify(body)).toString('base64'),
              requestId,
              responseCode: 200,
              responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
            },
            message.sessionId,
          )
        }
      } catch {}
      return
    }
    if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params
      const url = new URL(request.url)
      intercepted.push(request.url)
      const page =
        url.origin === ATS
          ? url.pathname === '/smoke/frames'
            ? FRAMES_PAGE
            : url.pathname === '/smoke/inner'
              ? INNER_PAGE
              : ATS_PAGE
          : url.origin === WORKDAY
            ? WORKDAY_PAGE
            : url.origin === CLASSIC
              ? CLASSIC_PAGE
            : url.origin === SITE && url.pathname === '/job'
              ? sitePage(websiteBundle)
              : null
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
    if (message.method === 'Target.detachedFromTarget') {
      const { sessionId: detached, targetId } = message.params
      if (autoSessions.get(targetId) === detached) autoSessions.delete(targetId)
      sessionTypes.delete(detached)
      sessionReady.delete(detached)
      return
    }
    if (message.method !== 'Target.attachedToTarget') return
    const { sessionId, targetInfo, waitingForDebugger } = message.params
    if (autoSessions.has(targetInfo.targetId)) return
    autoSessions.set(targetInfo.targetId, sessionId)
    let settle = () => {}
    sessionReady.set(sessionId, new Promise((done) => {
      settle = done
    }))
    if (targetInfo.type === 'iframe') pickerParents.set(targetInfo.targetId, message.sessionId ?? null)
    sessionTypes.set(sessionId, targetInfo.type)
    let setupError = null
    try {
      await browser.send('Network.enable', {}, sessionId)
      if (targetInfo.type === 'page') {
        await browser.send('Fetch.enable', { patterns: [{ urlPattern: `${SITE}/*` }, { urlPattern: `${ATS}/*` }, { urlPattern: `${WORKDAY}/*` }, { urlPattern: `${CLASSIC}/*` }] }, sessionId)
      }
      if (targetInfo.type === 'service_worker') {
        await browser.send('Fetch.enable', { patterns: [{ urlPattern: `${API}/*` }] }, sessionId)
      }
      if (targetInfo.type === 'iframe') {
        await browser.send('Page.enable', {}, sessionId)
        await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: PICKER_HOOK }, sessionId)
      }
    } catch (error) {
      setupError = `domain setup: ${error.message}`
    }
    if (waitingForDebugger) {
      await browser.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch((error) => {
        setupError = [setupError, `resume: ${error.message}`].filter(Boolean).join('; ')
      })
    }
    if (setupError) setupErrors.push({ error: setupError, type: targetInfo.type, url: targetInfo.url.replace(/^chrome-extension:\/\/[a-p]+/, '') })
    settle(setupError ? { error: setupError, ok: false } : { ok: true })
  })
  browser.on((message) => {
    if (message.sessionId) return
    if (message.method === 'Target.targetCreated' || message.method === 'Target.targetInfoChanged') {
      const info = message.params.targetInfo
      targetLog.set(info.targetId, { destroyed: false, type: info.type, url: info.url })
    }
    if (message.method === 'Target.targetDestroyed') {
      const known = targetLog.get(message.params.targetId)
      if (known) known.destroyed = true
    }
  })
  await browser.send('Target.setDiscoverTargets', { discover: true })
  await browser.send('Target.setAutoAttach', { autoAttach: true, flatten: true, waitForDebuggerOnStart: true })

  const liveTarget = (test) => [...targetLog.entries()].find(([, info]) => !info.destroyed && test(info))?.[0] ?? null
  const attach = async (targetId, what = targetId) => {
    const deadline = Date.now() + 20_000
    for (;;) {
      let attached = null
      try {
        attached = (await browser.send('Target.attachToTarget', { flatten: true, targetId })).sessionId
        await browser.send('Runtime.enable', {}, attached)
        await browser.send('Page.enable', {}, attached)
        return attached
      } catch (error) {
        if (attached) await browser.send('Target.detachFromTarget', { sessionId: attached }).catch(() => {})
        if (!cdpNotReady(error) || Date.now() > deadline) throw new Error(`could not attach to ${what}: ${error.message}`)
        setupRetries.push({ step: `attach ${what}`, error: error.message })
        await wait(250)
      }
    }
  }
  const setupEvaluate = async (sessionOf, reattach, expression, timeoutMs, what) => {
    const deadline = Date.now() + 20_000
    for (;;) {
      try {
        return await evaluate(browser, sessionOf(), expression, timeoutMs)
      } catch (error) {
        if (!cdpNotReady(error) || Date.now() > deadline) throw error
        setupRetries.push({ step: what, error: error.message })
        await wait(250)
        await reattach()
      }
    }
  }
  const readySession = async (targetId, timeoutMs) => {
    const sessionId = autoSessions.get(targetId)
    if (!sessionId) return null
    const ready = sessionReady.get(sessionId)
    if (!ready) return null
    const outcome = await Promise.race([ready, wait(timeoutMs).then(() => ({ error: 'setup still running', ok: false }))])
    return outcome.ok && autoSessions.get(targetId) === sessionId ? sessionId : null
  }

  const serviceWorker = async () => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const targets = await browser.send('Target.getTargets')
      const found = targets.targetInfos.find(
        (target) => target.type === 'service_worker' && target.url === workerUrl,
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

  const runningWorker = async () =>
    (await browser.send('Target.getTargets')).targetInfos.find(
      (target) => target.type === 'service_worker' && target.url === workerUrl,
    ) ?? null
  const stopWorker = async () => {
    if (!(await runningWorker())) return 'no worker running'
    const crashesBefore = crashed.length
    await browser.send('ServiceWorker.enable', {}, sessionId)
    const statesBefore = workerStates.length
    await browser.send('ServiceWorker.stopAllWorkers', {}, sessionId)
    const stoppedRunning = () => {
      const ran = new Set(workerStates.filter((state) => state.status === 'running').map((state) => state.id))
      return workerStates.slice(statesBefore).some((state) => state.status === 'stopped' && ran.has(state.id))
    }
    await waitFor(stoppedRunning, Boolean, 10_000, 'the service worker to stop')
    check('stopping the service worker crashes no page, frame or extension document', collateralCrashes(crashesBefore).length === 0, JSON.stringify(collateralCrashes(crashesBefore)))
    return 'ServiceWorker.stopAllWorkers'
  }

  await serviceWorker()
  const extensionOrigin = `chrome-extension://${extensionId}`
  report.push(`extension ${extensionId} (copy of ${build})`)
  const popupUrl = `${extensionOrigin}/popup.html`
  const page = await browser.send('Target.createTarget', { url: popupUrl })
  let sessionId = await attach(page.targetId, 'the popup harness page')
  await wait(1000)
  await setupEvaluate(
    () => sessionId,
    async () => {
      await browser.send('Target.detachFromTarget', { sessionId }).catch(() => {})
      sessionId = await attach(liveTarget((info) => info.type === 'page' && info.url === popupUrl) ?? page.targetId, 'the popup harness page')
    },
    harness,
    30_000,
    'inject the popup harness',
  )
  await requireExtensionApis(browser, sessionId, page.targetId)
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

  check('a fresh profile stores no suggestion preference', (await run(SWITCH_STORED)) === false)

  await run(SET_SWITCH(false))
  const offFrom = requests.length
  const disabled = await run(SUGGEST(requestFor(ACCEPTED)))
  check('an explicit false switch answers disabled', disabled.status === 'disabled', JSON.stringify(disabled))
  const stopsBefore = workerStates.filter((state) => state.status === 'stopped').length
  const restarting = stopWorker()
  await waitFor(() => workerStates.filter((state) => state.status === 'stopped').length > stopsBefore, Boolean, 10_000, 'the idle service worker to stop')
  const disabledAfterRestart = await run(SUGGEST(requestFor(ACCEPTED)))
  const offRestart = await restarting
  check(
    'an explicit false switch stays off after the service worker restarts',
    offRestart !== 'no worker running' && disabledAfterRestart.status === 'disabled',
    `${offRestart} ${JSON.stringify(disabledAfterRestart)}`,
  )
  check('a disabled switch never starts the classifier', (await offscreenCount()) === 0)
  check('a disabled switch never fetches a classifier asset', classifierFetches(offFrom).length === 0)

  await run(SET_SWITCH('on'))
  const invalidFrom = requests.length
  const invalid = await run(SUGGEST(requestFor(ACCEPTED)))
  check('an invalid stored switch value answers disabled', invalid.status === 'disabled', JSON.stringify(invalid))
  check('an invalid stored switch value never starts the classifier', (await offscreenCount()) === 0 && classifierFetches(invalidFrom).length === 0)

  await run(CLEAR_SWITCH)
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
  check('with no stored preference the classifier runs by default and stores nothing', ['classified', 'abstained'].includes(cold.status) && (await run(SWITCH_STORED)) === false, JSON.stringify(cold).slice(0, 200))
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

  const backgroundHarness = autoSessions.get((await serviceWorker()).targetId)
  await evaluate(browser, backgroundHarness, harness, 30_000)
  const closing = await evaluate(
    browser,
    backgroundHarness,
    CALL(`const caller = { serviceWorker: typeof ServiceWorkerGlobalScope === 'function' && self instanceof ServiceWorkerGlobalScope, script: self.location.pathname }
      const requests = Array.from({ length: 128 }, (_, index) => ({ answerKind: 'text', input: { questionText: 'Describe the production incident you resolved ' + index, fieldType: 'TextArea', jobCountry: '_unknown', optionLabels: [] } }))
      const started = performance.now()
      const inflight = __classify(requests).then(() => 'answered', (error) => error.message)
      await new Promise((done) => setTimeout(done, 1500))
      const closedAt = Math.round(performance.now() - started)
      await __closeClassifier()
      const outcome = await inflight
      return { caller, closedAt, outcome, ms: Math.round(performance.now() - started) }`),
    60_000,
  )
  await wait(1500)
  check(
    'the deliberate close runs from the background service worker',
    closing.caller.serviceWorker === true && closing.caller.script === '/background.js',
    JSON.stringify(closing.caller),
  )
  check('a deliberate close rejects the in-flight background request promptly', closing.outcome === 'the classifier was closed' && closing.ms < 5_000, JSON.stringify(closing))
  check('a deliberate close is not retried', (await offscreenCount()) === 0)
  const recreated = await evaluate(
    browser,
    backgroundHarness,
    CALL(`const [decision] = await __classify([{ answerKind: ${JSON.stringify(ACCEPTED.answerKind)}, input: ${JSON.stringify(ACCEPTED.input)} }])
      return { decision, status: await __status() }`),
    60_000,
  )
  check(
    'a classification after a deliberate close recreates the runtime',
    (await offscreenCount()) === 1 &&
      recreated.decision.labelEnumId === ACCEPTED.decision.labelEnumId &&
      close(recreated.decision.calibratedConfidence, ACCEPTED.decision.calibratedConfidence) &&
      recreated.status.runtimeId === status.runtimeId,
    JSON.stringify(recreated),
  )
  report.push(`deliberate close from ${closing.caller.script}: closed at ${closing.closedAt} ms, rejected at ${closing.ms} ms`)
  await run(CALL('await __closeClassifier(); return true'))
  await waitFor(offscreenCount, (count) => count === 0, 10_000, 'the offscreen document to close for the popup harness')

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
  const siteSession = await attach(site.targetId, 'the handoff site page')
  await browser.send('Page.navigate', { url: `${SITE}/job` }, siteSession)
  await waitFor(
    () => evaluate(browser, siteSession, `typeof __handoff === 'function' && typeof chrome?.runtime?.sendMessage === 'function'`, 5_000),
    Boolean,
    20_000,
    'the handoff page',
  )

  const fieldsReady = (atsSession) =>
    waitFor(
      () => evaluate(browser, atsSession, `document.querySelectorAll('[data-tp-field]').length`, 5_000),
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
    const destinationTarget = async () =>
      liveTarget((info) => info.type === 'page' && info.url === destination) ??
      (await browser.send('Target.getTargets')).targetInfos.find((info) => info.type === 'page' && info.url === destination)?.targetId ??
      null
    let openError = null
    if (!(await destinationTarget())) {
      await evaluate(browser, siteSession, `window.open(${JSON.stringify(destination)}, '_blank'); true`, 5_000, { userGesture: true }).catch((error) => {
        openError = error
      })
    }
    const targetId = await waitFor(destinationTarget, Boolean, 20_000, `the application tab for ${destination}`).catch((error) => {
      throw openError ?? error
    })
    if (openError) setupRetries.push({ step: `window.open ${destination}`, error: `${openError.message}; the tab was created anyway, so it was not opened again` })
    const target = { targetId }
    const atsSession = await attach(target.targetId, `the application tab ${destination}`)
    await browser.send('Target.setAutoAttach', { autoAttach: true, flatten: true, waitForDebuggerOnStart: true }, atsSession)
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

  await run(SET_SWITCH(true))

  const clickAt = async (atsSession, box, origin = { x: 0, y: 0 }) => {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await browser.send(
        'Input.dispatchMouseEvent',
        { button: 'left', clickCount: 1, type, x: origin.x + box.x + box.width / 2, y: origin.y + box.y + box.height / 2 },
        atsSession,
      )
    }
  }
  const clickCenter = async (atsSession, expression) => {
    const box = await evaluate(browser, atsSession, expression, 5_000)
    if (!box) throw new Error(`nothing to click: ${expression}`)
    await clickAt(atsSession, box)
  }
  const pickerTargets = async () =>
    (await browser.send('Target.getTargets')).targetInfos.filter(
      (info) => info.type === 'iframe' && info.url.startsWith('chrome-extension://') && new URL(info.url).pathname === '/picker.html',
    )
  const isActivePicker = async (target) => {
    const session = await readySession(target.targetId, 2_000)
    if (!session) return false
    return evaluate(browser, session, `document.documentElement.getAttribute('data-tp-active') === 'true'`, 2_000).catch(() => false)
  }
  const activePickers = async () => {
    const targets = await pickerTargets()
    const active = await Promise.all(targets.map(isActivePicker))
    return targets.filter((_, index) => active[index])
  }
  const pickerTarget = async () => (await activePickers())[0] ?? null
  const pickerClosed = (_session, timeoutMs, what) => waitFor(pickerTarget, (target) => !target, timeoutMs, what)
  const pickerFramesIn = async (session) =>
    (await pickerTargets()).filter((target) => pickerParents.get(target.targetId) === session).length
  const pickerSession = async () => {
    const target = await pickerTarget()
    if (!target) return null
    return autoSessions.get(target.targetId) ?? null
  }
  const pickerFrameOrigin = async (atsSession) => {
    const { root } = await browser.send('DOM.getDocument', { depth: -1, pierce: true }, atsSession)
    const stack = [root]
    while (stack.length) {
      const node = stack.pop()
      const attributes = node.attributes ?? []
      const src = attributes[attributes.indexOf('src') + 1]
      if (node.nodeName === 'IFRAME' && attributes.includes('src') && src.includes('/picker.html')) {
        const { model } = await browser.send('DOM.getBoxModel', { nodeId: node.nodeId }, atsSession)
        return { x: model.content[0], y: model.content[1] }
      }
      stack.push(...(node.children ?? []), ...(node.shadowRoots ?? []), ...(node.contentDocument ? [node.contentDocument] : []))
    }
    throw new Error('the picker frame is not in the page')
  }
  const pickerFrameRect = async (session) => {
    const { root } = await browser.send('DOM.getDocument', { depth: -1, pierce: true }, session)
    const stack = [root]
    while (stack.length) {
      const node = stack.pop()
      const attributes = node.attributes ?? []
      const src = attributes[attributes.indexOf('src') + 1] ?? ''
      if (node.nodeName === 'IFRAME' && src.includes('/picker.html')) {
        if (!attributes.includes('data-tp-ready')) return null
        const { model } = await browser.send('DOM.getBoxModel', { nodeId: node.nodeId }, session)
        const [x1, y1, , , x3, y3] = model.border
        return { x: x1, y: y1, width: x3 - x1, height: y3 - y1 }
      }
      stack.push(...(node.children ?? []), ...(node.shadowRoots ?? []))
    }
    return null
  }
  const PAGE_DOWNS = `(() => {
    if (!window.__tpPageDowns) {
      window.__tpPageDowns = { count: 0 }
      document.addEventListener('mousedown', (event) => { if (event.isTrusted) window.__tpPageDowns.count += 1 }, true)
    }
    return window.__tpPageDowns.count
  })()`
  const clickInPicker = async (atsSession, selector) => {
    const session = await pickerSession()
    const box = session ? await evaluate(browser, session, RECT(selector), 5_000) : null
    if (!box) throw new Error(`nothing to click in the picker: ${selector}`)
    await clickAt(atsSession, box, await pickerFrameOrigin(atsSession))
  }
  const pickerState = async () => {
    const session = await pickerSession()
    if (!session) return { open: false }
    try {
      return await evaluate(browser, session, PICKER_STATE, 5_000)
    } catch {
      return { open: false }
    }
  }
  const pageBridge = (atsSession) => evaluate(browser, atsSession, 'window.__bridgeSeen ?? []', 5_000)
  const tabIdOf = async (session) => {
    const url = await evaluate(browser, session, 'location.href', 5_000)
    return run(CALL(`return (await chrome.tabs.query({})).find((tab) => tab.url === ${JSON.stringify(url)})?.id ?? null`))
  }
  const openPickerByCommand = async (session, inputSelector) => {
    await browser.send('Page.bringToFront', {}, session)
    await clickCenter(session, RECT(inputSelector))
    const tabId = await tabIdOf(session)
    await run(CALL(`try { await chrome.tabs.sendMessage(${tabId}, { kind: 'cmd.openPicker' }) } catch {}
      return true`))
  }
  const confirmState = async () => {
    const session = await pickerSession()
    if (!session) return { open: false }
    try {
      return await evaluate(browser, session, `({ open: true, confirm: Boolean(document.querySelector('[data-tp-confirm-fill]')) })`, 5_000)
    } catch {
      return { open: false }
    }
  }
  const openPicker = async (atsSession, field) => {
    await browser.send('Page.bringToFront', {}, atsSession)
    if ((await pickerState()).open || (await pickerTarget())) {
      await clickCenter(atsSession, `({ x: 1, y: 1, width: 2, height: 2 })`)
      await pickerClosed(atsSession, 5_000, 'the previous picker to close')
    }
    await evaluate(browser, atsSession, RECORD_BRIDGE, 5_000)
    await openPickerByCommand(atsSession, `#${field} input`)
    const opening = waitFor(
      async () => {
        const target = await pickerTarget()
        return { ...(await pickerState()), target: target?.url ?? null, attached: target ? autoSessions.has(target.targetId) : false }
      },
      (state) => state.open && state.list !== undefined,
      20_000,
      'the picker to open',
    )
    try {
      return await opening
    } catch (error) {
      const frames = await pickerFrameDom(atsSession).catch((domError) => [{ error: domError.message }])
      const parented = (await pickerTargets()).filter((target) => pickerParents.get(target.targetId) === atsSession)
      const targets = await Promise.all(
        parented.map(async (target) => {
          const session = await readySession(target.targetId, 2_000)
          const view = session
            ? await evaluate(browser, session, `({ active: document.documentElement.getAttribute('data-tp-active'), rendered: (document.getElementById('app')?.children.length ?? 0) > 0 })`, 2_000).catch((viewError) => ({ error: viewError.message }))
            : null
          return { attached: autoSessions.has(target.targetId), ready: Boolean(session), view }
        }),
      )
      const evidence = JSON.stringify({ frames, setupErrors: setupErrors.slice(-5), targets })
      if (frames.length === 0) throw new Error(`product: no picker iframe was created after one open command; ${error.message}; ${evidence}`)
      if (!frames.some((frame) => frame.ready === 'true')) throw new Error(`product: the picker iframe exists but never became ready; ${error.message}; ${evidence}`)
      if (!targets.some((target) => target.ready)) {
        throw new Error(`harness: the picker iframe is ready but no target parented to this tab has a ready session; ${error.message}; ${evidence}`)
      }
      throw new Error(`product: the picker target has a ready session but did not activate or render; ${error.message}; ${evidence}`)
    }
  }
  const pickerFrameDom = async (atsSession) => {
    const { root } = await browser.send('DOM.getDocument', { depth: -1, pierce: true }, atsSession)
    const stack = [root]
    const frames = []
    while (stack.length) {
      const node = stack.pop()
      const attributes = node.attributes ?? []
      const attr = (name) => (attributes.includes(name) ? attributes[attributes.indexOf(name) + 1] : null)
      if (node.nodeName === 'IFRAME' && (attr('src') ?? '').includes('/picker.html')) {
        frames.push({ ready: attr('data-tp-ready'), style: (attr('style') ?? '').replace(/\s+/g, ' ').slice(0, 120) })
      }
      stack.push(...(node.children ?? []), ...(node.shadowRoots ?? []))
    }
    return frames
  }
  const answered = (state) => state.sends >= 1 && state.done >= state.sends
  const settledState = async (expectSuggestion) => {
    const state = await pickerState()
    if (!state.open || !state.list || state.items === 0) return state
    if (!expectSuggestion || !answered(state)) return state
    await wait(600)
    const later = await pickerState()
    return later.sends === state.sends && answered(later) ? later : state
  }
  const settled = (expectSuggestion = true) =>
    waitFor(
      () => settledState(expectSuggestion),
      (state) => state.open && state.list && state.items > 0 && (!expectSuggestion || answered(state)),
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

  const checkCommandPicker = async (name, session, expected) => {
    await browser.send('Page.bringToFront', {}, session)
    const registered = await evaluate(
      browser,
      session,
      `({ fields: document.querySelectorAll('[data-tp-field]').length, icons: document.querySelectorAll('[data-tp-field-widget]').length, inputs: [...document.querySelectorAll('[data-tp-field]')].map((field) => '#' + (field.matches('input') ? field : field.querySelector('input')).id) })`,
      5_000,
    )
    check(`${name}: every field is registered`, registered.fields === expected, JSON.stringify(registered))
    check(`${name}: no field icon is mounted while icons are disabled`, registered.icons === 0, JSON.stringify(registered))
    for (const selector of registered.inputs) {
      await openPickerByCommand(session, selector)
      const opened = await waitFor(pickerState, (state) => state.open && state.list !== undefined, 20_000, `the picker for ${selector}`)
      check(`${name}: focusing ${selector} and sending the picker command opens the picker`, opened.open)
      await clickCenter(session, `({ x: 1, y: 1, width: 2, height: 2 })`)
      await pickerClosed(session, 5_000, `the picker for ${selector} to close`)
    }
    const native = await evaluate(browser, session, `({ clicks: window.__nativeClicks, submits: window.__submits })`, 5_000)
    check(`${name}: opening the picker never reaches the native controls`, native.clicks === 0 && native.submits === 0, JSON.stringify(native))
  }
  await checkCommandPicker('Greenhouse', uk.atsSession, FIELDS.length)
  check('every Greenhouse picker open reuses one picker frame', (await pickerFramesIn(uk.atsSession)) === 1, String(await pickerFramesIn(uk.atsSession)))
  for (const delay of [0, 20]) {
    const results = []
    for (const field of ['f-first', 'f-links', 'f-exact']) {
      await openPicker(uk.atsSession, field)
      const rect = await waitFor(() => pickerFrameRect(uk.atsSession), Boolean, 10_000, `the ${field} picker frame to show`)
      const before = await evaluate(browser, uk.atsSession, PAGE_DOWNS, 5_000)
      await clickCenter(uk.atsSession, `({ x: 1, y: 1, width: 2, height: 2 })`)
      if (delay) await wait(delay)
      const started = Date.now()
      await clickAt(uk.atsSession, rect)
      const ms = Date.now() - started
      const after = await evaluate(browser, uk.atsSession, PAGE_DOWNS, 5_000)
      results.push({ delivered: after === before + 2, ms })
      await pickerClosed(uk.atsSession, 5_000, `the ${field} picker to close`)
    }
    check(
      `a click ${delay} ms after closing reaches the page where the picker was, without a stall`,
      results.every((result) => result.delivered && result.ms < 1_000),
      JSON.stringify(results),
    )
  }
  const classicTab = await browser.send('Target.createTarget', { url: 'about:blank' })
  const classicSession = await attach(classicTab.targetId, 'the classic tab')
  await browser.send('Page.enable', {}, classicSession)
  await browser.send('Runtime.enable', {}, classicSession)
  await browser.send('Target.setAutoAttach', { autoAttach: true, flatten: true, waitForDebuggerOnStart: true }, classicSession)
  await browser.send('Page.navigate', { url: `${CLASSIC}/smoke/jobs/1` }, classicSession)
  await waitFor(
    () => evaluate(browser, classicSession, `document.querySelectorAll('[data-tp-field]').length`, 5_000),
    (count) => count === CLASSIC_FIELDS.length,
    30_000,
    'the Greenhouse Classic adapter to register every field',
  )
  await checkCommandPicker('Greenhouse Classic', classicSession, CLASSIC_FIELDS.length)
  await browser.send('Target.closeTarget', { targetId: classicTab.targetId })
  await browser.send('Page.bringToFront', {}, uk.atsSession)

  const signedOut = await openPicker(uk.atsSession, 'f-first')
  const signIn = await waitFor(pickerState, (state) => state.signIn, 10_000, 'the signed-out picker')
  check('the real picker opens from the picker command in an extension frame', signedOut.open)
  check('a signed-out picker offers no suggestion row', signIn.rows.length === 0, JSON.stringify(signIn.rows))
  check('a signed-out picker never asks for a suggestion', signIn.sends === 0, String(signIn.sends))

  await clickCenter(uk.atsSession, `({ x: 1, y: 1, width: 2, height: 2 })`)
  await pickerClosed(uk.atsSession, 5_000, 'the picker to close before the Workday checks')

  const workdayTab = await browser.send('Target.createTarget', { url: 'about:blank' })
  const workdaySession = await attach(workdayTab.targetId, 'the workday tab')
  await browser.send('Page.enable', {}, workdaySession)
  await browser.send('Runtime.enable', {}, workdaySession)
  await browser.send('Target.setAutoAttach', { autoAttach: true, flatten: true, waitForDebuggerOnStart: true }, workdaySession)
  await browser.send('Page.navigate', { url: `${WORKDAY}/Smoke/job/apply/applyManually` }, workdaySession)
  await browser.send('Page.bringToFront', {}, workdaySession)
  const workdayRegistered = await waitFor(
    () =>
      evaluate(
        browser,
        workdaySession,
        `({ fields: document.querySelectorAll('[data-tp-field]').length, email: Boolean(document.querySelector('[data-automation-id="formField-email"] [data-tp-field], [data-automation-id="formField-email"][data-tp-field]')), icons: document.querySelectorAll('[data-tp-field-widget]').length })`,
        5_000,
      ),
    (state) => state.email,
    30_000,
    'the Workday adapter to register the email field',
  )
  check('Workday: no field icon is mounted while icons are disabled', workdayRegistered.icons === 0, JSON.stringify(workdayRegistered))
  await openPickerByCommand(workdaySession, '[data-automation-id="formField-email"] input')
  const workdayPicker = await waitFor(pickerState, (state) => state.open && state.list !== undefined, 20_000, 'the Workday picker to open')
  const workdayNative = await evaluate(browser, workdaySession, `({ clicks: window.__nativeClicks, submits: window.__submits })`, 5_000)
  check('focusing the Workday email field and sending the picker command opens the picker', workdayPicker.open, JSON.stringify(workdayPicker))
  check('opening the Workday picker never reaches the native submit controls', workdayNative.clicks === 0 && workdayNative.submits === 0, JSON.stringify(workdayNative))
  await clickCenter(workdaySession, `({ x: 1, y: 1, width: 2, height: 2 })`)
  await pickerClosed(workdaySession, 5_000, 'the Workday picker to close')
  await browser.send('Target.closeTarget', { targetId: workdayTab.targetId })

  const framesTab = await browser.send('Target.createTarget', { url: 'about:blank' })
  const framesSession = await attach(framesTab.targetId, 'the frames tab')
  await browser.send('Page.enable', {}, framesSession)
  await browser.send('Runtime.enable', {}, framesSession)
  await browser.send('Target.setAutoAttach', { autoAttach: true, flatten: true, waitForDebuggerOnStart: true }, framesSession)
  await browser.send('Page.navigate', { url: `${ATS}/smoke/frames` }, framesSession)
  await browser.send('Page.bringToFront', {}, framesSession)
  const FRAME_MARKERS = `(() => { const inner = document.getElementById('inner')?.contentDocument; return { top: document.querySelectorAll('[data-tp-field]').length, inner: inner ? inner.querySelectorAll('[data-tp-field]').length : -1 } })()`
  await waitFor(() => evaluate(browser, framesSession, FRAME_MARKERS, 5_000), (markers) => markers.top === 1 && markers.inner === 1, 30_000, 'both frames to register their field')
  const innerBox = await evaluate(
    browser,
    framesSession,
    `(() => { const frame = document.getElementById('inner'); const f = frame.getBoundingClientRect(); const r = frame.contentDocument.getElementById('inner-first').getBoundingClientRect(); return { x: f.x + r.x, y: f.y + r.y, width: r.width, height: r.height } })()`,
    5_000,
  )
  const PICKER_HOSTS = `(() => { const count = (doc) => [...doc.documentElement.children].filter((el) => el.getAttribute('data-tp-open') === 'true').length; return { top: count(document), inner: count(document.getElementById('inner').contentDocument) } })()`
  const pickerFrames = async () => (await activePickers()).length
  const framesTabId = await tabIdOf(framesSession)
  const sendPickerCommand = () =>
    run(CALL(`try { await chrome.tabs.sendMessage(${framesTabId}, { kind: 'cmd.openPicker' }) } catch {}
      return true`))

  await clickAt(framesSession, innerBox)
  await clickCenter(framesSession, RECT('#top-first'))
  await sendPickerCommand()
  await waitFor(pickerFrames, (count) => count >= 1, 20_000, 'the picker for the focused top frame')
  await wait(1_500)
  const topOnly = { frames: await pickerFrames(), hosts: await evaluate(browser, framesSession, PICKER_HOSTS, 5_000) }
  check('the picker command opens one picker, in the focused top frame only', topOnly.frames === 1 && topOnly.hosts.top === 1 && topOnly.hosts.inner === 0, JSON.stringify(topOnly))
  await clickCenter(framesSession, `({ x: 1, y: 1, width: 2, height: 2 })`)
  await waitFor(pickerFrames, (count) => count === 0, 5_000, 'the top-frame picker to close')

  await clickAt(framesSession, innerBox)
  await sendPickerCommand()
  await waitFor(pickerFrames, (count) => count >= 1, 20_000, 'the picker for the focused inner frame')
  await wait(1_500)
  const innerOnly = { frames: await pickerFrames(), hosts: await evaluate(browser, framesSession, PICKER_HOSTS, 5_000) }
  check('the picker command opens one picker, in the focused inner frame only', innerOnly.frames === 1 && innerOnly.hosts.top === 0 && innerOnly.hosts.inner === 1, JSON.stringify(innerOnly))
  await browser.send('Target.closeTarget', { targetId: framesTab.targetId })
  await browser.send('Page.bringToFront', {}, uk.atsSession)

  const linkedLabel = PAGE_ACCEPTED.decision.labelEnumId
  const formCountry = PAGE_ACCEPTED.input.jobCountry
  let linkedQuestion = null
  for (const question of LINKED_CANDIDATES) {
    const decision = await run(CLASSIFY({ answerKind: 'text', fieldType: 'TextInput', optionLabels: [], questionText: question }, formCountry))
    if (decision.labelEnumId === linkedLabel) {
      linkedQuestion = question
      break
    }
  }
  check('a stored question links to the accepted field label under the form country', linkedQuestion !== null, `${formCountry}: ${LINKED_CANDIDATES.join(' / ')}`)
  check(
    'the reused question is not country-sensitive and the form country differs from the stored one',
    linkedQuestion !== null &&
      !(await run(`__isCountryScoped(${JSON.stringify(linkedQuestion)})`)) &&
      !(await run(`__isCountryScoped(${JSON.stringify(PAGE_ACCEPTED.input.questionText)})`)) &&
      formCountry !== '_unknown' &&
      formCountry !== LINKED_STORED_COUNTRY,
    `${linkedQuestion} / ${formCountry} / ${LINKED_STORED_COUNTRY}`,
  )
  const now = new Date().toISOString()
  const answer = async (id, questionText, value, jobCountry = null) => ({
    answerKind: 'text',
    answerText: value,
    answerValue: { confidence: 'exact', kind: 'string', value },
    ats: 'greenhouseReact',
    createdAt: now,
    fieldType: 'TextInput',
    id,
    jobCountry,
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
    await answer('smoke-linked', linkedQuestion, LINKED_VALUE, LINKED_STORED_COUNTRY),
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
  const signedOffFrom = requests.length
  await openPicker(uk.atsSession, 'f-first')
  await settled(false)
  await wait(1000)
  const signedInOff = await pickerState()
  check('signed in with the switch off: no row', signedInOff.rows.length === 0, JSON.stringify(signedInOff.rows))
  check('signed in with the switch off: no background suggestion request', signedInOff.sends === 0, String(signedInOff.sends))
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
    const state = await settled()
    check(`${name} shows its saved answer`, state.rows.length === 1 && state.rows[0].title === value, JSON.stringify(state.rows))
    check(`${name} never starts the model`, (await offscreenCount()) === 0)
    check(`${name} fetches no classifier asset`, classifierFetches(from).length === 0, JSON.stringify(classifierFetches(from)))
  }

  await seed()
  const coldStarted = Date.now()
  await openPicker(uk.atsSession, 'f-first')
  await waitFor(pickerState, (state) => state.sends >= 1, 20_000, 'the picker suggestion request')
  await waitFor(offscreenCount, (count) => count === 1, 20_000, 'the model process to start for the picker request')
  const pickerStopped = await stopWorker()
  const shown = await settled()
  const pickerSends = shown.sends
  report.push(`picker cold suggestion, service worker stopped while the model loaded (${pickerStopped}): ${Date.now() - coldStarted} ms, ${pickerSends} sends`)
  check('the service worker was stopped during the picker cold load', pickerStopped !== 'no worker running', pickerStopped)
  check('the picker request was retried exactly once', pickerSends === 2, `sends ${pickerSends}`)
  check('an accepted label with a saved answer shows exactly one row', shown.rows.length === 1, JSON.stringify({ results: shown.results, rows: shown.rows }))
  check(
    'the row holds only the saved answer and Suggested answer',
    shown.rows[0]?.title === LINKED_VALUE &&
      shown.rows[0]?.badge === 'Suggested answer' &&
      shown.rows[0]?.spans === 2 &&
      shown.rows[0]?.compact === `${LINKED_VALUE}Suggested answer`.replace(/\s+/g, ''),
    JSON.stringify(shown.rows[0]),
  )
  const shownBridge = await pageBridge(uk.atsSession)
  const rowLeaks = secretsOf(PAGE_ACCEPTED)
    .filter((secret) => (shown.rows[0]?.html ?? '').includes(secret))
    .concat(exposure(shownBridge, PAGE_ACCEPTED))
    .concat(shownBridge.filter((message) => message.includes(LINKED_VALUE) || message.includes('classifier.')))
  check('the row, and the page bridge before the click, carry no suggestion or classifier detail', rowLeaks.length === 0, rowLeaks.join(', '))
  const nativeBeforeFill = await evaluate(browser, uk.atsSession, `({ clicks: window.__nativeClicks, submits: window.__submits })`, 5_000)
  await clickInPicker(uk.atsSession, '[data-tp-suggestion]')
  const filled = await waitFor(
    () => evaluate(browser, uk.atsSession, `document.querySelector('#first').value`, 5_000),
    (value) => value === LINKED_VALUE,
    10_000,
    'the field to fill',
  )
  check('clicking the row fills the real field', filled === LINKED_VALUE, filled)
  const fillBridge = (await pageBridge(uk.atsSession)).filter((message) => message.includes(LINKED_VALUE))
  check(
    'only the one selected value crosses into the page, as a single field fill',
    fillBridge.length === 1 && JSON.parse(fillBridge[0]).payload.kind === 'field.fill',
    JSON.stringify(fillBridge),
  )
  const closedAfterFill = await pickerClosed(uk.atsSession, 10_000, 'the picker to close after the fill')
  check('clicking the row closes the picker', !closedAfterFill)
  const nativeAfterFill = await evaluate(browser, uk.atsSession, `({ clicks: window.__nativeClicks, submits: window.__submits })`, 5_000)
  check(
    'clicking the row never submits the form or reaches its native controls',
    nativeAfterFill.submits === 0 && JSON.stringify(nativeAfterFill) === JSON.stringify(nativeBeforeFill),
    JSON.stringify([nativeBeforeFill, nativeAfterFill]),
  )
  const crossCountry = await run(CALL(`return (await chrome.storage.session.get('${ANSWER_LABELS_KEY}'))['${ANSWER_LABELS_KEY}']`))
  check(
    `the ${LINKED_STORED_COUNTRY} saved answer was classified with the ${formCountry} form country, not its stored country`,
    crossCountry?.entries?.['smoke-linked']?.input === `text\u0000field type: TextInput | job country: ${formCountry} | question: ${linkedQuestion}` &&
      crossCountry.entries['smoke-linked'].labelEnumId === linkedLabel,
    JSON.stringify(crossCountry?.entries?.['smoke-linked']),
  )

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
  const reopened = await settled()
  check('reopening the picker shows the row again', reopened.rows.length === 1 && reopened.rows[0].title === LINKED_VALUE, JSON.stringify(reopened.rows))
  check('reopening reuses the stored-answer labels without reclassifying', (await run('window.__labelWrites')) === 0)

  for (const [name, field, item] of [
    ['an abstention', 'f-links', PAGE_ABSTAINED],
    ['an accepted label without a saved answer', 'f-portfolio', PAGE_NO_ANSWER],
  ]) {
    await seed()
    await run(BIND(uk.atsTabId, uk.destination, item.input.jobCountry))
    await openPicker(uk.atsSession, field)
    const state = await settled()
    check(`signed in, ${name} shows no row`, state.rows.length === 0, JSON.stringify(state.rows))
    const visible = exposure(await pageBridge(uk.atsSession), item)
    check(`signed in, ${name} puts no classifier detail on the page`, visible.length === 0, visible.join(', '))
  }

  const otherCountry = await run(CALL(`return (await chrome.storage.session.get('${ANSWER_LABELS_KEY}'))['${ANSWER_LABELS_KEY}']`))
  check(
    `a form in another country (${PAGE_NO_ANSWER.input.jobCountry}) reclassifies the saved answer without a new revision`,
    otherCountry?.entries?.['smoke-linked']?.input === `text\u0000field type: TextInput | job country: ${PAGE_NO_ANSWER.input.jobCountry} | question: ${linkedQuestion}` &&
      otherCountry.entries['smoke-linked'].revision === now,
    JSON.stringify(otherCountry?.entries?.['smoke-linked']),
  )

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
  const served = (url) => [SITE, ATS, WORKDAY, CLASSIC].some((origin) => url.startsWith(origin))
  const external = requests.filter((request) => /^https?:/.test(request.url) && !served(request.url))
  check('no request left the served test pages during the whole run', external.length === 0, JSON.stringify(external))
  check('every served page request was answered locally', intercepted.every(served), intercepted.join(', '))
  report.push(`network: ${requests.length} requests recorded, ${intercepted.length} page requests served locally, ${external.length} external`)

  await run(SET_SWITCH(false))
  await waitFor(offscreenCount, (count) => count === 0, 10_000, 'the offscreen document to close')
  const noteWorker = autoSessions.get((await serviceWorker()).targetId)
  await evaluate(browser, noteWorker, RECORD_CLASSIFIER_POSTS, 10_000)
  await run(CALL(`await chrome.storage.session.remove(['${ANSWER_LABELS_KEY}', '${PROFILE_KEY}'])`))
  const { talentAnswers: _answers, talentNotes: _notes, ...firstProfile } = PROFILE
  apiState.profile = firstProfile
  apiState.answers = answers
  apiState.notes = [NOTE]
  await run(SET_SWITCH(true))
  await run(CALL(`await chrome.storage.local.set({ '${TOKENS_KEY}': ${JSON.stringify(TOKENS)} })`))
  await run(BIND(uk.atsTabId, secondJob, PAGE_ACCEPTED.input.jobCountry))
  const noteFrom = requests.length
  const apiFrom = apiCalls.length
  await openPicker(uk.atsSession, 'f-first')
  const withNote = await settled()
  const hydration = apiCalls.slice(apiFrom).map((call) => `${call.method} ${new URL(call.url).pathname}`)
  check(
    'the background hydrates profile, saved answers and notes from their own routes',
    ['GET /api/v1/talentprofile/first', 'GET /api/v1/talentanswer', 'GET /api/v1/talentnote'].every((route) => hydration.includes(route)),
    JSON.stringify(hydration),
  )
  const hydrated = await run(CALL(`return (await chrome.storage.session.get('${PROFILE_KEY}'))['${PROFILE_KEY}']?.data?.talentNotes ?? null`))
  check('the hydrated profile cache holds the note from the note route', JSON.stringify(hydrated) === JSON.stringify([NOTE]), JSON.stringify(hydrated))
  check('with a private note saved, the picker still shows the linked suggestion', withNote.rows.length === 1 && withNote.rows[0].title === LINKED_VALUE, JSON.stringify(withNote.rows))
  const classifierPosts = await evaluate(browser, noteWorker, 'globalThis.__classifierPosts', 10_000)
  check(
    'the field and every stored answer were sent to the classifier',
    classifierPosts.filter((post) => JSON.parse(post).kind === 'classify').length >= 2,
    `${classifierPosts.length} posts`,
  )
  check('no classifier request carries the private note', classifierPosts.every((post) => !post.includes(NOTE_SENTINEL)))
  const labelCache = await run(CALL(`return JSON.stringify(await chrome.storage.session.get('${ANSWER_LABELS_KEY}'))`))
  check('the stored-answer label cache holds no private note', labelCache.includes('smoke-linked') && !labelCache.includes(NOTE_SENTINEL))

  await clickInPicker(uk.atsSession, '[data-tp-item-id="notes"] button.item')
  const noteLeaf = await waitFor(
    async () => {
      const session = await pickerSession()
      return session ? evaluate(browser, session, NOTE_LEAF, 5_000) : null
    },
    Boolean,
    10_000,
    'the note in the Notes group',
  )
  check('the picker still lists the note in the Notes group', noteLeaf.kind === 'note-leaf' && noteLeaf.text.includes(NOTE_SENTINEL), JSON.stringify(noteLeaf))
  const noteBridge = await pageBridge(uk.atsSession)
  check('the page bridge never carries the note while it is listed', noteBridge.length > 0 && noteBridge.every((message) => !message.includes(NOTE_SENTINEL)), `${noteBridge.length} messages`)
  await clickInPicker(uk.atsSession, `[data-tp-item-id="nt.${NOTE.id}"] button.item`)
  const inserted = await waitFor(
    () => evaluate(browser, uk.atsSession, `document.querySelector('#first').value`, 5_000),
    (value) => value === NOTE_SENTINEL,
    10_000,
    'the note to be inserted',
  )
  check('clicking the note inserts it into the field', inserted === NOTE_SENTINEL, inserted)
  const insertBridge = (await pageBridge(uk.atsSession)).filter((message) => message.includes(NOTE_SENTINEL))
  check('the inserted note never travels over the page bridge', insertBridge.length === 0, JSON.stringify(insertBridge))
  const touch = await waitFor(
    () => apiCalls.slice(apiFrom).filter((call) => call.method === 'PUT' && call.url.endsWith('/api/v1/talentnote')),
    (found) => found.length === 1,
    10_000,
    'the note usage update',
  )
  check('the note usage update sends the note id, not its content', touch[0].postData?.includes(NOTE.id) && !touch[0].postData.includes(NOTE_SENTINEL), JSON.stringify(touch))
  const noteNetwork = requests.slice(noteFrom).filter((request) => `${request.url}${request.postData ?? ''}`.includes(NOTE_SENTINEL))
  check('no network request carries the private note', noteNetwork.length === 0, JSON.stringify(noteNetwork))
  const noteExternal = requests
    .slice(noteFrom)
    .filter((request) => /^https?:/.test(request.url) && !served(request.url) && !request.url.startsWith(API))
  check('nothing but the API left the test pages', noteExternal.length === 0, JSON.stringify(noteExternal))
  report.push(`private note: hydrated via ${hydration.join(', ')}; ${classifierPosts.length} classifier posts; usage update ${touch[0].method} ${touch[0].url}`)

  await clickCenter(uk.atsSession, `({ x: 1, y: 1, width: 2, height: 2 })`)
  await pickerClosed(uk.atsSession, 5_000, 'the picker to close before the forgery run')
  const secrets = [PROFILE.profileName, PROFILE.jobTitle, PROFILE.user.email, NOTE_SENTINEL, LINKED_VALUE, EXACT_VALUE, OVERLAP_VALUE, linkedQuestion]
  const forgedRecord = {
    answerKind: 'text',
    answerText: 'forged answer',
    answerValue: { confidence: 'exact', kind: 'string', value: 'forged answer' },
    fieldType: 'TextInput',
    labelEnumId: null,
    normalizedQuestion: 'forged-question',
    profileField: null,
    questionText: 'Forged question',
    resolverOutcome: 'filled',
    section: '',
    source: 'manual',
    sourceAnswerId: null,
  }
  const fieldAsk = (name) => ({ fieldName: name, fieldType: 'TextInput', requestId: `forged-${name}`, section: '' })
  const FORGED = [
    { kind: 'auth.getProfile' },
    { kind: 'auth.getSummary' },
    { kind: 'auth.getStatus' },
    { kind: 'auth.requestSignIn' },
    { kind: 'auth.openDashboard' },
    { kind: 'profile.get' },
    { content: 'forged note', kind: 'note.create' },
    { content: 'forged note', kind: 'note.update', noteId: NOTE.id },
    { kind: 'note.delete', noteId: NOTE.id },
    { kind: 'note.touch', noteId: NOTE.id },
    { fieldName: 'Email', fieldType: 'TextInput', kind: 'resolveFieldValue', section: '' },
    { fields: ['Email', 'Full name', 'Current title'].map(fieldAsk), kind: 'resolveFieldValues' },
    { fields: [EXACT_QUESTION, linkedQuestion].map(fieldAsk), kind: 'resolveLearnedAnswers' },
    { answerId: 'smoke-linked', kind: 'learnedAnswer.delete' },
    { kind: 'classifier.suggest', request: requestFor(PAGE_ACCEPTED) },
    { kind: 'answers.stage', payload: { applicationUrl: secondJob, ats: 'greenhouseReact', records: [forgedRecord] } },
    { kind: 'answers.commit', stageId: 'forged-stage' },
    { kind: 'answers.discard', outcome: 'unknown', stageId: 'forged-stage' },
    { kind: 'fill.request' },
    { kind: 'widget.openDashboard' },
    { kind: 'capture.submit', records: [forgedRecord] },
    { batchId: 'forged-batch', fields: ['Email', 'Full name', EXACT_QUESTION].map(fieldAsk), kind: 'fill.fields' },
  ].map((payload) => ({ id: crypto.randomUUID(), ...payload }))
  const CLICKS = [['form widget', ['[data-tp-form-widget]', 'button.primary']]]
  const storageSnapshot = () =>
    run(CALL(`return JSON.stringify([await chrome.storage.local.get(null), await chrome.storage.session.get(null)])`))
  const pages = async () => (await browser.send('Target.getTargets')).targetInfos.filter((info) => info.type === 'page').length
  const storageBefore = await storageSnapshot()
  const pagesBefore = await pages()
  const forgeryFrom = requests.length
  const forgeryApiFrom = apiCalls.length
  const fieldsBefore = await evaluate(browser, uk.atsSession, `[...document.querySelectorAll('input')].map((input) => input.value)`, 5_000)
  await browser.send('Page.bringToFront', {}, uk.atsSession)
  await wait(2_500)
  const forgery = await evaluate(browser, uk.atsSession, FORGE_BRIDGE(FORGED, CLICKS, 5_000), 30_000)
  await wait(1_000)
  report.push(`forgery: ${FORGED.length} privileged messages, programmatic clicks ${JSON.stringify(forgery.clicked)}, ${forgery.replies.length} content replies`)
  check('the page script reached the form widget it tried to click', forgery.clicked['form widget'] === true, JSON.stringify(forgery.clicked))
  const replyKinds = [...new Set(forgery.replies.map((reply) => JSON.parse(reply).kind))]
  check('forged messages get nothing back but a fill refusal', replyKinds.every((kind) => kind === 'fill.denied'), JSON.stringify(forgery.replies).slice(0, 400))
  check(
    'every forged fill request is refused as untrusted',
    forgery.replies.every((reply) => JSON.parse(reply).reason === 'untrusted'),
    JSON.stringify(forgery.replies).slice(0, 400),
  )
  const leaked = secrets.filter((secret) => forgery.replies.some((reply) => reply.includes(secret)))
  check('no forged message returns profile, note or saved-answer data', leaked.length === 0, leaked.join(', '))
  const forgeryRequests = requests.slice(forgeryFrom).filter((request) => /^https?:/.test(request.url) && !request.url.startsWith(ATS))
  check('no forged message causes an API or network call', forgeryRequests.length === 0 && apiCalls.length === forgeryApiFrom, JSON.stringify(forgeryRequests.concat(apiCalls.slice(forgeryApiFrom))))
  check('no forged message loads the classifier', classifierFetches(forgeryFrom).length === 0, JSON.stringify(classifierFetches(forgeryFrom)))
  check('no forged message mutates extension storage', (await storageSnapshot()) === storageBefore)
  check('no forged message opens a tab', (await pages()) === pagesBefore)
  check('no forged message or synthetic click opens the picker', (await pickerTarget()) === null)
  const fieldsAfter = await evaluate(browser, uk.atsSession, `[...document.querySelectorAll('input')].map((input) => input.value)`, 5_000)
  check('no forged message fills a field', JSON.stringify(fieldsAfter) === JSON.stringify(fieldsBefore), JSON.stringify(fieldsAfter))

  await evaluate(
    browser,
    uk.atsSession,
    `(() => { const el = document.createElement('div'); el.id = 'forged-widget'; el.setAttribute('data-tp-form-widget', 'true'); el.style.cssText = 'position:fixed;left:24px;bottom:24px;width:140px;height:40px;background:#111;z-index:2147483646'; document.body.appendChild(el); return true })()`,
    5_000,
  )
  await evaluate(browser, uk.atsSession, RECORD_BRIDGE, 5_000)
  const forgedWidgetApiFrom = apiCalls.length
  await clickCenter(uk.atsSession, RECT('#forged-widget'))
  await evaluate(
    browser,
    uk.atsSession,
    FORGE_BRIDGE(
      [
        { id: crypto.randomUUID(), kind: 'fill.request' },
        { batchId: 'forged-batch', fields: ['Email', 'Full name', 'Resume/CV'].map(fieldAsk), id: crypto.randomUUID(), kind: 'fill.fields' },
      ],
      [],
      1_500,
    ),
    10_000,
  )
  const forgedConfirm = await waitFor(confirmState, (state) => state.open, 10_000, 'the extension-origin fill confirmation')
  check('a real click on a page-forged widget only opens the extension-origin confirmation', forgedConfirm.confirm === true, JSON.stringify(forgedConfirm))
  await browser.send('Input.dispatchKeyEvent', { code: 'Escape', key: 'Escape', type: 'keyDown', windowsVirtualKeyCode: 27 }, uk.atsSession)
  await browser.send('Input.dispatchKeyEvent', { code: 'Escape', key: 'Escape', type: 'keyUp', windowsVirtualKeyCode: 27 }, uk.atsSession)
  await pickerClosed(uk.atsSession, 5_000, 'the forged confirmation to close')
  await wait(500)
  const forgedWidgetBridge = (await pageBridge(uk.atsSession)).map((message) => JSON.parse(message).payload)
  const forgedWidgetReplies = forgedWidgetBridge.filter((payload) => ['fill.denied', 'fill.run', 'fill.values'].includes(payload?.kind))
  check(
    'dismissing the confirmation refuses the forged fill and returns no values',
    forgedWidgetReplies.length > 0 && forgedWidgetReplies.every((payload) => payload.kind === 'fill.denied') && forgedWidgetReplies.some((payload) => payload.reason === 'dismissed'),
    JSON.stringify(forgedWidgetReplies),
  )
  check('the forged widget fill leaks no profile data', !secrets.some((secret) => forgedWidgetBridge.some((payload) => JSON.stringify(payload).includes(secret))))
  check('the forged widget fill reaches no API', apiCalls.length === forgedWidgetApiFrom, JSON.stringify(apiCalls.slice(forgedWidgetApiFrom)))
  check('the forged widget fill changes no field', JSON.stringify(await evaluate(browser, uk.atsSession, `[...document.querySelectorAll('input')].map((input) => input.value)`, 5_000)) === JSON.stringify(fieldsBefore))
  await evaluate(browser, uk.atsSession, `document.getElementById('forged-widget')?.remove(); true`, 5_000)

  const inputValues = () =>
    evaluate(browser, uk.atsSession, `Object.fromEntries([...document.querySelectorAll('input')].map((input) => [input.id, input.value]).sort())`, 5_000)
  const PORTFOLIO_VALUE = 'https://portfolio.example.invalid/smoke'
  const portfolioAnswer = await answer('smoke-portfolio', PAGE_NO_ANSWER.input.questionText, PORTFOLIO_VALUE)
  await run(
    CALL(`const key = '${PROFILE_KEY}'
      const cached = (await chrome.storage.session.get(key))[key]
      cached.data.talentAnswers = [...cached.data.talentAnswers, ${JSON.stringify(portfolioAnswer)}]
      cached.fetchedAt = Date.now()
      await chrome.storage.session.set({ [key]: cached })
      return true`),
  )
  const expectedFill = Object.fromEntries(
    Object.entries({ exact: '', first: PROFILE.profileName.split(' ')[0], links: '', overlap: '', portfolio: PORTFOLIO_VALUE }).sort(),
  )
  const freshApplication = async (name) => {
    await browser.send('Page.navigate', { url: `${ATS}/smoke/jobs/${name}?source=talentprofile` }, uk.atsSession)
    await fieldsReady(uk.atsSession)
  }
  await freshApplication('popup-fill')
  const popupFill = await run(
    CALL(`return await new Promise((done) => {
      const port = chrome.runtime.connect({ name: 'fill-progress' })
      port.onMessage.addListener((message) => {
        if (message.kind === 'fill.done' || message.kind === 'fill.error') {
          port.disconnect()
          done(message)
        }
      })
      port.postMessage({ kind: 'fill.start', tabId: ${uk.atsTabId} })
    })`),
  )
  const popupValues = await inputValues()
  check('the popup fill completes', popupFill.kind === 'fill.done' && popupFill.result.counts.filled === 2, JSON.stringify([popupFill, popupValues]))
  check('the popup fill writes the profile first name and the exact-match saved answer', JSON.stringify(popupValues) === JSON.stringify(expectedFill), JSON.stringify(popupValues))

  await freshApplication('widget-fill')
  await browser.send('Page.bringToFront', {}, uk.atsSession)
  await clickCenter(
    uk.atsSession,
    `(() => { const r = document.querySelector('[data-tp-form-widget]')?.shadowRoot?.querySelector('button.primary')?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null })()`,
  )
  const widgetConfirm = await waitFor(confirmState, (state) => state.open && state.confirm, 10_000, 'the widget fill confirmation')
  check('a real click on the form widget asks for confirmation in an extension frame', widgetConfirm.confirm === true, JSON.stringify(widgetConfirm))
  check('the widget click alone fills nothing', JSON.stringify(await inputValues()) !== JSON.stringify(expectedFill))
  await clickInPicker(uk.atsSession, '[data-tp-confirm-fill]')
  const widgetValues = await waitFor(inputValues, (values) => values.first !== '', 20_000, 'the confirmed widget fill')
  await wait(1_000)
  check('confirming in the extension frame fills the same values', JSON.stringify(await inputValues()) === JSON.stringify(expectedFill), JSON.stringify(widgetValues))
  await freshApplication('responsive')
  await run(SET_SWITCH(false))
  await waitFor(offscreenCount, (count) => count === 0, 10_000, 'the offscreen document to close')
  const loadWorker = autoSessions.get((await serviceWorker()).targetId)
  await evaluate(browser, loadWorker, RECORD_CLASSIFIER_POSTS, 10_000)
  await run(SET_SWITCH(true))
  const LOAD_ANSWERS = 128
  const loadAnswers = []
  for (let index = 0; index < LOAD_ANSWERS; index += 1) {
    loadAnswers.push({
      ...(await answer(`smoke-load-${index}`, `Describe a project where you used technology number ${index} and what the result was`, `Load answer ${index}`)),
      updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    })
  }
  await run(
    CALL(`await chrome.storage.session.remove('${ANSWER_LABELS_KEY}')
      await chrome.storage.session.set({ '${PROFILE_KEY}': { data: ${JSON.stringify({ ...PROFILE, talentAnswers: loadAnswers })}, fetchedAt: Date.now() } })
      return true`),
  )
  await run(BIND(uk.atsTabId, `${ATS}/smoke/jobs/responsive?source=talentprofile`, PAGE_ACCEPTED.input.jobCountry))
  const loadCrashes = crashed.length
  const loadStarted = Date.now()
  const loadMoves = []
  let loadProbing = true
  const loadProbe = (async () => {
    let flip = 0
    while (loadProbing) {
      const rect = await pickerFrameRect(uk.atsSession).catch(() => null)
      if (rect) {
        flip += 1
        const sent = Date.now()
        let acked = false
        await Promise.race([
          browser
            .send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x + rect.width / 2 + (flip % 2 ? 6 : -6), y: rect.y + Math.min(rect.height / 2, 40) }, uk.atsSession)
            .then(() => {
              acked = true
            }),
          wait(5_000),
        ])
        loadMoves.push({ acked, ms: Date.now() - sent, sent })
      }
      await wait(150)
    }
  })()
  await openPicker(uk.atsSession, 'f-first')
  const loaded = await waitFor(pickerState, (state) => state.sends >= 1 && state.done >= state.sends, 120_000, 'the suggestion over the uncached saved answers')
  const loadAnswered = Date.now()
  await wait(500)
  loadProbing = false
  await loadProbe
  const loadPulse = await evaluate(browser, await pickerSession(), `({ gaps: __tpPulse.gaps, moves: __tpPulse.moves })`, 5_000)
  const loadStalls = loadPulse.gaps.filter((gap) => gap.at >= loadStarted && gap.at - gap.gap <= loadAnswered + 500)
  const loadMaxStall = loadStalls.reduce((largest, gap) => Math.max(largest, gap.gap), 0)
  const loadSeen = loadPulse.moves.filter((at) => at >= loadStarted).length
  const loadPosts = (await evaluate(browser, loadWorker, 'globalThis.__classifierPosts', 10_000))
    .map((post) => JSON.parse(post))
    .filter((post) => post.kind === 'classify')
  const loadLabels = await run(CALL(`return Object.keys((await chrome.storage.session.get('${ANSWER_LABELS_KEY}'))['${ANSWER_LABELS_KEY}']?.entries ?? {}).filter((id) => id.startsWith('smoke-load-')).length`))
  report.push(
    `responsiveness: ${LOAD_ANSWERS} uncached answers in ${loadAnswered - loadStarted} ms, ${loadPosts.length} classify posts, picker max stall ${loadMaxStall} ms, ${loadMoves.length} pointer moves, slowest ack ${loadMoves.reduce((largest, move) => Math.max(largest, move.ms), 0)} ms`,
  )
  check(
    'every uncached saved answer was classified in chunks of at most 8',
    loadLabels === LOAD_ANSWERS &&
      loadPosts.filter((post) => post.requests.length !== 1).every((post) => post.requests.length <= 8) &&
      loadPosts.reduce((total, post) => total + post.requests.length, 0) >= LOAD_ANSWERS,
    JSON.stringify({ labels: loadLabels, posts: loadPosts.map((post) => post.requests.length) }),
  )
  check(
    'the picker stays responsive while uncached saved answers are classified',
    loaded.open &&
      loadMaxStall < 250 &&
      loadMoves.length >= 5 &&
      loadMoves.every((move) => move.acked && move.ms < 1_000) &&
      loadSeen === loadMoves.length &&
      collateralCrashes(loadCrashes).length === 0,
    JSON.stringify({ crashes: collateralCrashes(loadCrashes), maxStall: loadMaxStall, moves: loadMoves.map((move) => [move.acked, move.ms]), seen: loadSeen, stalls: loadStalls }),
  )
  await clickCenter(uk.atsSession, `({ x: 1, y: 1, width: 2, height: 2 })`)
  await pickerClosed(uk.atsSession, 5_000, 'the responsiveness picker to close')
  await freshApplication('disable')
  const disableOpen = await openPicker(uk.atsSession, 'f-first')
  check('the picker is open before the site is disabled', disableOpen.open)
  const disabledFrame = (await pickerTargets()).find((target) => pickerParents.get(target.targetId) === uk.atsSession)
  await run(CALL(`await chrome.runtime.sendMessage({ kind: 'origin.disable', pattern: '${ATS}/*' }).catch(() => null)
    return true`))
  await pickerClosed(uk.atsSession, 10_000, 'the disabled site to close the picker')
  const disabledUi = disabledFrame
    ? await evaluate(browser, autoSessions.get(disabledFrame.targetId), `({ text: document.getElementById('app')?.textContent ?? '', children: document.getElementById('app')?.children.length ?? -1, active: document.documentElement.getAttribute('data-tp-active') })`, 5_000)
    : null
  check('disabling the site closes the picker and clears its answers', disabledUi?.children === 0 && disabledUi.text === '' && disabledUi.active === null, JSON.stringify(disabledUi))
  check('no page, frame or extension document crashed during the smoke', collateralCrashes().length === 0, JSON.stringify(collateralCrashes()))
  report.push(`cdp setup retries: ${setupRetries.length ? JSON.stringify(setupRetries) : 'none'}`)
  report.push(`cdp session setup errors: ${setupErrors.length ? JSON.stringify(setupErrors) : 'none'}`)
  browser.close()
} catch (error) {
  failure = error
  if (collateralCrashes().length > 0) report.push(`crashed targets: ${JSON.stringify(collateralCrashes())}`)
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

import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { extensionIdOf, requireExtensionApis } from './extension-identity.mjs'

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.CHROME_SMOKE_PORT ?? 9338)
const root = resolve(import.meta.dirname, '..')
const build = resolve(root, '.output/chrome-mv3')
const out = resolve(root, 'docs/assets/screens')

const ATS = 'https://job-boards.greenhouse.io'
const API = 'https://backend.talentprofile.net'
const JOB_URL = `${ATS}/acme-robotics/jobs/4021?source=talentprofile`
const OTHER = 'https://careers.northpeak.example'
const OTHER_URL = `${OTHER}/jobs/118/apply`
const VIEWPORT = { width: 1280, height: 800 }
const SCALE = 2

const wait = (ms) => new Promise((done) => setTimeout(done, ms))
const base64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

const TOKENS = {
  accessToken: [
    base64url({ alg: 'none', typ: 'JWT' }),
    base64url({ email: 'alex.rivera@example.com', exp: 4102444800, iat: 1790000000, sub: 'demo-user' }),
    Buffer.from('demo-signature').toString('base64url'),
  ].join('.'),
  method: 'local',
  refreshToken: 'demo-refresh-token',
}

const NOW = '2026-09-01T00:00:00.000Z'
const NOTES = [
  {
    content: 'I build accessible, fast interfaces and care about the details users notice.',
    createdAt: NOW,
    id: 'demo-note-1',
    lastUsedAt: null,
    updatedAt: NOW,
  },
]
const PROFILE = {
  description: 'Frontend engineer with 8 years of experience building design systems and data-heavy web apps.',
  education: [
    {
      degree: 'BSc',
      description: null,
      endDate: '2016-06-01T00:00:00.000Z',
      fieldOfStudy: 'Computer Science',
      gpa: null,
      id: 'demo-edu-1',
      isCurrent: false,
      location: 'Lisbon, Portugal',
      school: 'University of Lisbon',
      startDate: '2012-09-01T00:00:00.000Z',
    },
  ],
  experience: [
    {
      company: 'Brightline Analytics',
      description: 'Led the migration of a dashboard suite to a shared component library.',
      employmentType: 'Full-time',
      endDate: null,
      id: 'demo-exp-1',
      isCurrent: true,
      location: 'Remote',
      startDate: '2021-03-01T00:00:00.000Z',
      title: 'Senior Frontend Engineer',
    },
    {
      company: 'Harbor Travel',
      description: 'Built the booking flow and checkout.',
      employmentType: 'Full-time',
      endDate: '2021-02-01T00:00:00.000Z',
      id: 'demo-exp-2',
      isCurrent: false,
      location: 'Lisbon, Portugal',
      startDate: '2017-01-01T00:00:00.000Z',
      title: 'Frontend Engineer',
    },
  ],
  hourlyRate: null,
  id: 'demo-profile',
  isAvailableForHire: true,
  isInterestedInRelocation: true,
  jobTitle: 'Senior Frontend Engineer',
  languages: [
    { id: 'demo-lang-1', language: 'English', rate: 5 },
    { id: 'demo-lang-2', language: 'Portuguese', rate: 5 },
  ],
  links: [
    { id: 'demo-link-1', label: 'linkedin', url: 'https://www.linkedin.com/in/alex-rivera-demo' },
    { id: 'demo-link-2', label: 'github', url: 'https://github.com/alex-rivera-demo' },
    { id: 'demo-link-3', label: 'other', url: 'https://alexrivera.example.com' },
  ],
  location: 'Lisbon, Portugal',
  monthlyRate: null,
  profileName: 'Alex Rivera',
  rateCurrency: null,
  skills: [
    { id: 'demo-skill-1', rate: 5, skill: 'TypeScript' },
    { id: 'demo-skill-2', rate: 5, skill: 'React' },
    { id: 'demo-skill-3', rate: 4, skill: 'Svelte' },
    { id: 'demo-skill-4', rate: 4, skill: 'CSS' },
    { id: 'demo-skill-5', rate: 4, skill: 'Node.js' },
    { id: 'demo-skill-6', rate: 4, skill: 'Accessibility' },
  ],
  talentAnswers: [],
  talentNotes: NOTES,
  totalExperience: '8',
  user: { email: 'alex.rivera@example.com', phoneNumber: '+1 415 555 0134' },
}

const FIELDS = [
  ['first_name', 'First Name'],
  ['last_name', 'Last Name'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['location', 'Location (City)'],
  ['linkedin', 'LinkedIn Profile'],
  ['website', 'Website'],
]

const JOB_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Senior Frontend Engineer - Acme Robotics</title>
<style>
*{box-sizing:border-box}
body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1d2433;background:#f4f6f9}
header{background:#fff;border-bottom:1px solid #e3e7ee;padding:18px 0}
.bar{max-width:760px;margin:0 auto;padding:0 24px;display:flex;align-items:center;gap:12px}
.mark{width:34px;height:34px;border-radius:8px;background:#2f5bd3;color:#fff;font-weight:700;display:grid;place-items:center}
.company{font-weight:600}
main{max-width:760px;margin:28px auto;padding:0 24px}
.card{background:#fff;border:1px solid #e3e7ee;border-radius:12px;padding:28px 32px}
h1{font-size:24px;margin:0 0 4px}
.meta{color:#5b6475;margin:0 0 24px}
h2{font-size:17px;margin:0 0 16px}
.application--container{margin-top:8px}
.field{margin:0 0 18px}
label{display:block;font-weight:600;font-size:14px;margin:0 0 6px}
input[type=text]{width:100%;padding:10px 12px;border:1px solid #c9d0db;border-radius:8px;font:inherit;background:#fff}
.actions{display:flex;gap:10px;margin-top:24px}
button{font:inherit;border-radius:8px;padding:10px 18px;border:1px solid #c9d0db;background:#fff;cursor:pointer}
button[type=submit]{background:#2f5bd3;border-color:#2f5bd3;color:#fff;font-weight:600}
</style>
</head><body>
<header><div class="bar"><div class="mark">A</div><div class="company">Acme Robotics</div></div></header>
<main><div class="card">
<h1>Senior Frontend Engineer</h1>
<p class="meta">Remote, Europe · Full-time</p>
<h2>Apply for this job</h2>
<div class="application--container">
  <div jaf-section="personal">
${FIELDS.map(([id, label]) => `    <div class="field"><div class="text-input-wrapper"><label for="${id}">${label}</label><input id="${id}" type="text" autocomplete="off"></div></div>`).join('\n')}
  </div>
  <div class="actions"><button type="submit" id="submit-application">Submit application</button></div>
</div>
</div></main>
<script>document.addEventListener('submit', (event) => event.preventDefault())</script>
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
      this.socket.onerror = () => fail(new Error('websocket failed'))
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
    return new Promise((done, fail) => {
      this.pending.set(id, { done, fail })
      this.socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }))
    })
  }

  on(listener) {
    this.listeners.push(listener)
  }

  close() {
    this.socket.close()
  }
}

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
  throw new Error(`timed out waiting for ${what}: ${JSON.stringify(last)?.slice(0, 300)}`)
}

const RECT = (selector) =>
  `(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null })()`

const workDir = await mkdtemp(join(tmpdir(), 'tp-docs-shots-'))
const extension = join(workDir, 'extension')
const profileDir = join(workDir, 'profile')
await cp(build, extension, { recursive: true })
const extensionId = await extensionIdOf(extension)
const workerUrl = `chrome-extension://${extensionId}/background.js`
await mkdir(out, { recursive: true })

const chrome = spawn(
  CHROME,
  [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${PORT}`,
    `--load-extension=${extension}`,
    `--disable-extensions-except=${extension}`,
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost',
    '--no-first-run',
    '--no-default-browser-check',
    '--headless=new',
    '--hide-scrollbars',
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const saved = []
try {
  const version = await endpoint('/json/version')
  const browser = new Session(version.webSocketDebuggerUrl)
  const sessions = new Map()
  const types = new Map()

  const evaluate = async (sessionId, expression, extra = {}) => {
    const result = await browser.send('Runtime.evaluate', { awaitPromise: true, expression, returnByValue: true, ...extra }, sessionId)
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'evaluation failed')
    return result.result.value
  }

  const fulfill = (sessionId, requestId, body, contentType) =>
    browser
      .send(
        'Fetch.fulfillRequest',
        {
          body: Buffer.from(body).toString('base64'),
          requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: contentType }],
        },
        sessionId,
      )
      .catch(() => {})

  const refuse = (sessionId, requestId) =>
    browser.send('Fetch.failRequest', { errorReason: 'BlockedByClient', requestId }, sessionId).catch(() => {})

  browser.on(async (message) => {
    if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params
      const url = new URL(request.url)
      if (url.origin === API) {
        const route = `${request.method} ${url.pathname}`
        const body =
          route === 'GET /api/v1/talentprofile/first'
            ? PROFILE
            : route === 'GET /api/v1/talentanswer'
              ? []
              : route === 'GET /api/v1/talentnote'
                ? NOTES
                : null
        await (body === null ? refuse(message.sessionId, requestId) : fulfill(message.sessionId, requestId, JSON.stringify(body), 'application/json'))
        return
      }
      await (url.origin === ATS || url.origin === OTHER
        ? fulfill(message.sessionId, requestId, JOB_PAGE, 'text/html; charset=utf-8')
        : refuse(message.sessionId, requestId))
      return
    }
    if (message.method !== 'Target.attachedToTarget') return
    const { sessionId, targetInfo, waitingForDebugger } = message.params
    if (!sessions.has(targetInfo.targetId)) {
      sessions.set(targetInfo.targetId, sessionId)
      types.set(sessionId, targetInfo.type)
      try {
        if (targetInfo.type === 'page') await browser.send('Fetch.enable', { patterns: [{ urlPattern: `${ATS}/*` }, { urlPattern: `${OTHER}/*` }] }, sessionId)
        if (targetInfo.type === 'service_worker') await browser.send('Fetch.enable', { patterns: [{ urlPattern: `${API}/*` }] }, sessionId)
      } catch {}
    }
    if (waitingForDebugger) await browser.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {})
  })
  await browser.send('Target.setAutoAttach', { autoAttach: true, flatten: true, waitForDebuggerOnStart: true })

  await waitFor(
    async () =>
      (await browser.send('Target.getTargets')).targetInfos.find(
        (target) => target.type === 'service_worker' && target.url === workerUrl,
      ),
    Boolean,
    30_000,
    'the extension service worker',
  )
  const extensionOrigin = `chrome-extension://${extensionId}`
  const attach = async (targetId) => (await browser.send('Target.attachToTarget', { flatten: true, targetId })).sessionId

  const control = await browser.send('Target.createTarget', { url: `${extensionOrigin}/popup.html` })
  const controlSession = await attach(control.targetId)
  await wait(1000)
  await requireExtensionApis((expression) => evaluate(controlSession, expression), control.targetId)
  await evaluate(
    controlSession,
    `(async () => {
      await chrome.storage.local.set({ 'tp.tokens': ${JSON.stringify(TOKENS)} })
      await chrome.storage.session.set({ 'tp.profileCache': { data: ${JSON.stringify(PROFILE)}, fetchedAt: Date.now() } })
      return true
    })()`,
  )

  const job = await browser.send('Target.createTarget', { url: JOB_URL })
  const jobSession = await attach(job.targetId)
  for (const domain of ['Page', 'Runtime', 'DOM']) await browser.send(`${domain}.enable`, {}, jobSession)
  await browser.send('Target.setAutoAttach', { autoAttach: true, flatten: true, waitForDebuggerOnStart: true }, jobSession)
  await browser.send(
    'Emulation.setDeviceMetricsOverride',
    { deviceScaleFactor: SCALE, height: VIEWPORT.height, mobile: false, width: VIEWPORT.width },
    jobSession,
  )
  await browser.send('Page.bringToFront', {}, jobSession)
  await waitFor(
    () => evaluate(jobSession, `document.querySelectorAll('[data-tp-field]').length`),
    (count) => count === FIELDS.length,
    30_000,
    'the adapter to register every field',
  )

  const capture = async (sessionId, name, format, clip, scale) => {
    const { data } = await browser.send(
      'Page.captureScreenshot',
      { captureBeyondViewport: false, format, ...(format === 'webp' ? { quality: 82 } : {}), ...(clip ? { clip: { ...clip, scale } } : {}) },
      sessionId,
    )
    const path = join(out, `${name}.${format}`)
    await writeFile(path, Buffer.from(data, 'base64'))
    saved.push(path)
  }

  const shoot = async (sessionId, name, clip, scale = 1, formats = ['webp']) => {
    await wait(500)
    for (const format of formats) await capture(sessionId, name, format, clip, scale)
  }

  const clickAt = async (sessionId, x, y) => {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await browser.send('Input.dispatchMouseEvent', { button: 'left', clickCount: 1, type, x, y }, sessionId)
    }
  }
  const clickCenter = async (sessionId, expression) => {
    const box = await evaluate(sessionId, expression)
    if (!box) throw new Error(`nothing to click: ${expression}`)
    await clickAt(sessionId, box.x + box.width / 2, box.y + box.height / 2)
  }

  const pickerTarget = async () => {
    const targets = (await browser.send('Target.getTargets')).targetInfos.filter(
      (info) => info.type === 'iframe' && info.url.startsWith(extensionOrigin) && new URL(info.url).pathname === '/picker.html',
    )
    for (const target of targets) {
      const session = sessions.get(target.targetId)
      if (!session) continue
      const active = await evaluate(session, `document.documentElement.getAttribute('data-tp-active') === 'true'`).catch(() => false)
      if (active) return { session, target }
    }
    return null
  }

  const pickerOrigin = async () => {
    const { root: documentRoot } = await browser.send('DOM.getDocument', { depth: -1, pierce: true }, jobSession)
    const stack = [documentRoot]
    while (stack.length) {
      const node = stack.pop()
      const attributes = node.attributes ?? []
      const src = attributes[attributes.indexOf('src') + 1] ?? ''
      if (node.nodeName === 'IFRAME' && src.includes('/picker.html') && attributes.includes('data-tp-ready')) {
        const { model } = await browser.send('DOM.getBoxModel', { nodeId: node.nodeId }, jobSession)
        return { x: model.content[0], y: model.content[1] }
      }
      stack.push(...(node.children ?? []), ...(node.shadowRoots ?? []))
    }
    throw new Error('the picker frame is not in the page')
  }

  const clickInPicker = async (selector) => {
    await wait(400)
    const picker = await waitFor(pickerTarget, Boolean, 10_000, 'an active picker')
    const box = await waitFor(() => evaluate(picker.session, RECT(selector)), Boolean, 10_000, `${selector} in the picker`)
    const origin = await pickerOrigin()
    await clickAt(jobSession, origin.x + box.x + box.width / 2, origin.y + box.y + box.height / 2)
  }

  await clickCenter(jobSession, RECT('#first_name'))
  const tabId = await evaluate(
    controlSession,
    `(async () => (await chrome.tabs.query({})).find((tab) => tab.url === ${JSON.stringify(JOB_URL)})?.id ?? null)()`,
  )
  await evaluate(controlSession, `(async () => { try { await chrome.tabs.sendMessage(${tabId}, { kind: 'cmd.openPicker' }) } catch {} return true })()`)
  const picker = await waitFor(pickerTarget, Boolean, 20_000, 'the picker to open')
  await waitFor(
    () => evaluate(picker.session, `document.querySelectorAll('.list .item-wrap').length`),
    (count) => count > 0,
    20_000,
    'picker rows',
  )
  await shoot(jobSession, 'picker-menu')

  await clickInPicker('[data-tp-item-id="identity"] button.item')
  await waitFor(
    async () => evaluate((await pickerTarget()).session, `Boolean(document.querySelector('[data-tp-item-id="id.first"]'))`),
    Boolean,
    10_000,
    'the identity submenu',
  )
  await shoot(jobSession, 'picker')

  await clickInPicker('[data-tp-item-id="id.first"] button.item')
  await waitFor(() => evaluate(jobSession, `document.querySelector('#first_name').value`), Boolean, 10_000, 'the first name to fill')
  await clickAt(jobSession, 5, VIEWPORT.height - 5)
  await waitFor(pickerTarget, (found) => !found, 10_000, 'the picker to close')
  await evaluate(jobSession, `document.querySelector('#first_name').value = ''; document.querySelector('#first_name').dispatchEvent(new Event('input', { bubbles: true })); document.activeElement?.blur(); true`)

  const widget = await waitFor(
    () =>
      evaluate(
        jobSession,
        `(() => {
          const host = document.querySelector('[data-tp-form-widget-host]')
          const roots = [...document.querySelectorAll('*')].filter((el) => el.shadowRoot)
          for (const el of roots) {
            const button = el.shadowRoot.querySelector('button.primary')
            if (button) { const r = button.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, host: Boolean(host) } }
          }
          return null
        })()`,
      ),
    Boolean,
    20_000,
    'the form fill widget',
  )
  await shoot(jobSession, 'form-widget')

  await clickAt(jobSession, widget.x + widget.width / 2, widget.y + widget.height / 2)
  await waitFor(pickerTarget, Boolean, 10_000, 'the fill confirmation')
  await waitFor(
    async () => evaluate((await pickerTarget()).session, `Boolean(document.querySelector('[data-tp-confirm-fill]'))`),
    Boolean,
    10_000,
    'the confirm button',
  )
  await shoot(jobSession, 'fill-confirm')

  await clickInPicker('[data-tp-confirm-fill]')
  await waitFor(
    () => evaluate(jobSession, `[...document.querySelectorAll('input[type=text]')].filter((input) => input.value).length`),
    (count) => count >= 5,
    20_000,
    'the form to fill',
  )
  await wait(1500)
  await shoot(jobSession, 'form-filled', undefined, 1, ['webp', 'png'])

  const shootPopup = async (name, forTabId, ready, prepare = '') => {
    const target = await browser.send('Target.createTarget', { url: 'about:blank' })
    const popupSession = await attach(target.targetId)
    for (const domain of ['Page', 'Runtime']) await browser.send(`${domain}.enable`, {}, popupSession)
    await browser.send(
      'Page.addScriptToEvaluateOnNewDocument',
      {
        source: `if (location.protocol === 'chrome-extension:') {
          const query = chrome.tabs.query.bind(chrome.tabs)
          chrome.tabs.query = (info, ...rest) =>
            info && info.active && info.currentWindow ? chrome.tabs.get(${forTabId}).then((tab) => [tab]) : query(info, ...rest)
        }`,
      },
      popupSession,
    )
    await browser.send(
      'Emulation.setDeviceMetricsOverride',
      { deviceScaleFactor: SCALE, height: 1000, mobile: false, width: 420 },
      popupSession,
    )
    await browser.send('Page.navigate', { url: `${extensionOrigin}/popup.html` }, popupSession)
    await waitFor(
      () => evaluate(popupSession, `[${ready.map((text) => JSON.stringify(text)).join(', ')}].every((text) => document.body?.innerText.includes(text))`),
      Boolean,
      20_000,
      `the popup to show ${ready.join(', ')}`,
    )
    if (prepare) await evaluate(popupSession, prepare)
    await wait(1000)
    const box = await evaluate(
      popupSession,
      `(() => {
        const root = (document.querySelector('#app > *') ?? document.body).getBoundingClientRect()
        const bottom = Math.max(root.bottom, ...[...document.querySelectorAll('#app *')].map((el) => el.getBoundingClientRect().bottom))
        return { x: 0, y: 0, width: root.width, height: Math.ceil(bottom) }
      })()`,
    )
    await shoot(popupSession, name, box, SCALE)
    await browser.send('Target.closeTarget', { targetId: target.targetId })
  }

  await shootPopup('popup', tabId, [PROFILE.profileName, 'Fill visible fields'])
  await shootPopup(
    'popup-settings',
    tabId,
    [PROFILE.profileName],
    `(async () => { document.querySelector('button.settings-btn').click(); await new Promise((done) => setTimeout(done, 300)); return document.body.innerText.includes('Classifier suggestions') })()`,
  )

  const other = await browser.send('Target.createTarget', { url: OTHER_URL })
  await waitFor(
    () => evaluate(controlSession, `(async () => (await chrome.tabs.query({})).find((tab) => tab.url === ${JSON.stringify(OTHER_URL)})?.id ?? null)()`),
    Boolean,
    20_000,
    'the other site tab',
  ).then((otherTabId) => shootPopup('popup-enable', otherTabId, [PROFILE.profileName, 'Enable here']))
  await browser.send('Target.closeTarget', { targetId: other.targetId })

  browser.close()
} finally {
  chrome.kill('SIGTERM')
  await wait(1000)
  await rm(workDir, { force: true, recursive: true })
}

console.log(`extension ${extensionId}`)
for (const path of saved) console.log(`wrote ${path}`)

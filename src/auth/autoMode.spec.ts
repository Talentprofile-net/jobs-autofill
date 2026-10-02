import { beforeEach, describe, expect, it } from 'bun:test'

import { installDom, setRect } from '~/core/__fixtures__/domGlobals'
import { assessApplicationEvidence } from './autoModeHeuristic'
import { createAutoModeWatcher } from './autoModeWatcher'

const layout = () => {
  for (const el of Array.from(document.querySelectorAll('*'))) setRect(el, { height: 30, width: 300, x: 100, y: 100 })
}

const mount = (body: string) => {
  const dom = installDom(`<html><body>${body}</body></html>`)
  Object.assign(dom.window, { getComputedStyle: () => ({ direction: 'ltr', display: 'block', visibility: 'visible' }), scrollX: 0, scrollY: 0 })
  layout()
  return dom
}

const verdict = () => assessApplicationEvidence(document).verdict

const append = (html: string) => {
  const holder = document.createElement('div')
  holder.innerHTML = html
  document.getElementById('app')!.appendChild(holder)
  layout()
}

const LATE_FORM = `<div class="application">
  <div><label for="fn">First Name</label><input id="fn" type="text"></div>
  <div><label for="ln">Last Name</label><input id="ln" type="text"></div>
  <div><label for="em">Email</label><input id="em" type="text"></div>
  <div><label for="ph">Mobile Number</label><input id="ph" type="tel"></div>
</div>`

const watch = () => {
  const listeners: Array<() => void> = []
  const timers: Array<() => void> = []
  let upgrades = 0
  const watcher = createAutoModeWatcher({
    clearTimer: () => {},
    debounceMs: 400,
    evaluate: verdict,
    observe: (fn) => {
      listeners.push(fn)
      return () => listeners.splice(listeners.indexOf(fn), 1)
    },
    onUpgrade: () => upgrades++,
    setTimer: (fn) => timers.push(fn),
  })
  const mutate = () => {
    for (const fn of [...listeners]) fn()
    while (timers.length) timers.shift()!()
  }
  return { listeners, mutate, upgrades: () => upgrades, watcher }
}

describe('application evidence', () => {
  it('treats a job description without controls as notes-only', () => {
    mount('<div id="app"><h1>Senior Engineer</h1><p>We value your resume and experience.</p><button>Apply</button></div>')
    expect(verdict()).toBe('notesOnly')
  })

  it('detects a late application form that has no <form> element', () => {
    mount('<div id="app"><h1>Senior Engineer</h1></div>')
    append(LATE_FORM)
    expect(assessApplicationEvidence(document)).toEqual({ reason: 'applicant fields: email,name,phone', verdict: 'application' })
  })

  it('detects a resume upload even before other fields', () => {
    mount('<div id="app"><label>CV or resume <input type="file" id="cv"></label></div>')
    expect(verdict()).toBe('application')
  })

  it('keeps a newsletter signup notes-only even next to application keywords', () => {
    mount(`<div id="app"><p>Upload your resume when you apply.</p>
      <form><label for="nl">Email</label><input id="nl" type="email"><button>Subscribe</button></form></div>`)
    expect(verdict()).toBe('notesOnly')
  })

  it('keeps a login page notes-only', () => {
    mount(`<div id="app"><form><label for="u">Email</label><input id="u" type="email">
      <label for="p">Password</label><input id="p" type="password"><label for="n">Full name</label><input id="n">
      <label for="t">Phone</label><input id="t" type="tel"><button>Sign in to apply</button></form></div>`)
    expect(verdict()).toBe('notesOnly')
  })

  it('keeps a job search page notes-only', () => {
    mount(`<div id="app"><form role="search"><input name="q" placeholder="Job title"><input name="where" placeholder="City">
      <input type="email" placeholder="Email me jobs"></form><p>equal opportunity employer</p></div>`)
    expect(verdict()).toBe('notesOnly')
  })
})

describe('auto mode watcher', () => {
  beforeEach(() => {
    mount('<div id="app"><h1>Senior Engineer</h1><p>Job description.</p></div>')
  })

  it('upgrades once when the application form renders after the description', () => {
    const w = watch()
    expect(w.watcher.verdict()).toBe('notesOnly')
    w.mutate()
    expect(w.upgrades()).toBe(0)
    append(LATE_FORM)
    w.mutate()
    expect(w.watcher.verdict()).toBe('application')
    expect(w.upgrades()).toBe(1)
    expect(w.listeners).toHaveLength(0)
  })

  it('upgrades for a delayed Recruitee-style form with a CV field', () => {
    const w = watch()
    append('<form><label>Full name <input name="name"></label><label>CV or resume <input type="file"></label></form>')
    w.mutate()
    expect(w.watcher.verdict()).toBe('application')
  })

  it('never reverts to notes-only after the form disappears', () => {
    const w = watch()
    append(LATE_FORM)
    w.mutate()
    document.getElementById('app')!.innerHTML = '<p>Thanks</p>'
    w.mutate()
    w.mutate()
    expect(w.watcher.verdict()).toBe('application')
    expect(w.upgrades()).toBe(1)
  })

  it('stays notes-only when only a newsletter box appears', () => {
    const w = watch()
    append('<form><label for="nl">Email</label><input id="nl" type="email"><button>Subscribe</button></form>')
    w.mutate()
    expect(w.watcher.verdict()).toBe('notesOnly')
    expect(w.listeners).toHaveLength(1)
  })

  it('does not observe at all when the page is already an application', () => {
    append(LATE_FORM)
    const w = watch()
    expect(w.watcher.verdict()).toBe('application')
    expect(w.listeners).toHaveLength(0)
    expect(w.upgrades()).toBe(0)
  })
})

const deepLayout = async () => {
  const { querySelectorAllDeep } = await import('~/core/shadowDom')
  for (const el of querySelectorAllDeep(document, '*')) setRect(el, { height: 30, width: 300, x: 100, y: 100 })
}

const shadowWatch = async () => {
  const { createDocumentTreeObserver } = await import('./autoModeWatcher')
  const timers: Array<() => void> = []
  const polls: Array<() => void> = []
  let pollsCleared = 0
  let upgrades = 0
  const tree = createDocumentTreeObserver(document, 2000, (fn) => polls.push(fn), () => pollsCleared++)
  const watcher = createAutoModeWatcher({
    clearTimer: () => {},
    debounceMs: 400,
    evaluate: verdict,
    observe: tree.observe,
    onUpgrade: () => upgrades++,
    setTimer: (fn) => timers.push(fn),
  })
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 0))
    await deepLayout()
    while (timers.length) timers.shift()!()
  }
  const tick = async () => {
    for (const poll of polls) poll()
    await settle()
  }
  return { pollsCleared: () => pollsCleared, settle, tick, tree, upgrades: () => upgrades, watcher }
}

describe('auto mode inside open shadow roots', () => {
  beforeEach(() => {
    mount('<div id="app"><h1>Senior Engineer</h1><apply-widget id="host"></apply-widget></div>')
  })

  it('upgrades when the late form renders inside an existing open shadow root', async () => {
    const root = document.getElementById('host')!.attachShadow({ mode: 'open' })
    const w = await shadowWatch()
    expect(w.watcher.verdict()).toBe('notesOnly')
    expect(w.tree.observedShadowRoots()).toBe(1)
    root.innerHTML = LATE_FORM
    await w.settle()
    expect(w.watcher.verdict()).toBe('application')
    expect(w.upgrades()).toBe(1)
  })

  it('finds a shadow root attached after startup without any document mutation', async () => {
    const w = await shadowWatch()
    expect(w.tree.observedShadowRoots()).toBe(0)
    const root = document.getElementById('host')!.attachShadow({ mode: 'open' })
    root.innerHTML = LATE_FORM
    await w.tick()
    expect(w.watcher.verdict()).toBe('application')
    expect(w.upgrades()).toBe(1)
  })

  it('reads evidence through nested open shadow roots', async () => {
    const outer = document.getElementById('host')!.attachShadow({ mode: 'open' })
    outer.innerHTML = '<section><inner-form id="inner"></inner-form></section>'
    const inner = outer.getElementById('inner')!.attachShadow({ mode: 'open' })
    inner.innerHTML = LATE_FORM
    await deepLayout()
    expect(verdict()).toBe('application')
  })

  it('keeps newsletter-only shadow content notes-only', async () => {
    const root = document.getElementById('host')!.attachShadow({ mode: 'open' })
    const w = await shadowWatch()
    root.innerHTML = '<form><label for="nl">Email</label><input id="nl" type="email"><button>Subscribe</button></form>'
    await w.settle()
    expect(w.watcher.verdict()).toBe('notesOnly')
    expect(w.upgrades()).toBe(0)
  })

  it('stays application, disconnects every observer and the poll, and never upgrades twice', async () => {
    const root = document.getElementById('host')!.attachShadow({ mode: 'open' })
    const w = await shadowWatch()
    root.innerHTML = LATE_FORM
    await w.settle()
    expect(w.tree.observedShadowRoots()).toBe(0)
    expect(w.pollsCleared()).toBe(1)
    root.innerHTML = '<p>done</p>'
    root.innerHTML = LATE_FORM
    await w.tick()
    expect(w.watcher.verdict()).toBe('application')
    expect(w.upgrades()).toBe(1)
  })
})

describe('auto mode shadow-root boundaries', () => {
  beforeEach(() => {
    mount('<div id="app"><h1>Senior Engineer</h1><apply-widget id="host"></apply-widget></div>')
  })

  it('observes a nested open shadow root that arrives through a shadow mutation', async () => {
    const outer = document.getElementById('host')!.attachShadow({ mode: 'open' })
    const w = await shadowWatch()
    expect(w.tree.observedShadowRoots()).toBe(1)
    const inner = document.createElement('inner-form')
    const innerRoot = inner.attachShadow({ mode: 'open' })
    outer.appendChild(inner)
    await w.settle()
    expect(w.tree.observedShadowRoots()).toBe(2)
    expect(w.watcher.verdict()).toBe('notesOnly')
    innerRoot.innerHTML = LATE_FORM
    await w.settle()
    expect(w.watcher.verdict()).toBe('application')
    expect(w.upgrades()).toBe(1)
  })

  it('keeps search controls inside a header-hosted shadow root excluded', async () => {
    document.getElementById('app')!.innerHTML = '<header><site-search id="search"></site-search></header>'
    const root = document.getElementById('search')!.attachShadow({ mode: 'open' })
    root.innerHTML = LATE_FORM
    await deepLayout()
    expect(verdict()).toBe('notesOnly')
  })

  it('never reads or observes a closed shadow root', async () => {
    const closed = document.getElementById('host')!.attachShadow({ mode: 'closed' })
    const w = await shadowWatch()
    closed.innerHTML = LATE_FORM
    await w.tick()
    expect(w.tree.observedShadowRoots()).toBe(0)
    expect(w.watcher.verdict()).toBe('notesOnly')
  })
})

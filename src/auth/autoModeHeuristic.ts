import { APPLICATION_KEYWORDS, APPLICATION_MIN_FIELD_COUNT } from '~/config'

const FIELD_SELECTOR = [
  'input:not([type="hidden"])',
  ':not([type="submit"])',
  ':not([type="button"])',
  ':not([type="reset"])',
  ':not([type="image"])',
  ':not([type="file"])',
  ':not([type="password"])',
  ', textarea',
  ', select',
  ', [role="combobox"]',
  ', [role="textbox"]',
  ', [contenteditable="true"]',
  ', [contenteditable=""]',
].join('')

const countVisibleFillableInputs = (): number => {
  const els = Array.from(document.querySelectorAll<HTMLElement>(FIELD_SELECTOR))
  let count = 0
  for (const el of els) {
    if (el.hasAttribute('disabled')) continue
    if (el.getAttribute('aria-hidden') === 'true') continue
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    count++
    if (count >= APPLICATION_MIN_FIELD_COUNT) return count
  }
  return count
}

const hasApplicationKeywords = (): boolean => {
  const bodyText = (document.body?.innerText ?? '').toLowerCase()
  if (!bodyText) return false
  const sample = bodyText.length > 20000 ? bodyText.slice(0, 20000) : bodyText
  return APPLICATION_KEYWORDS.some((kw) => sample.includes(kw))
}

export const resolveAutoModeFromDom = (): 'application' | 'notesOnly' => {
  const inputs = countVisibleFillableInputs()
  if (inputs < APPLICATION_MIN_FIELD_COUNT) return 'notesOnly'
  if (!hasApplicationKeywords()) return 'notesOnly'
  return 'application'
}
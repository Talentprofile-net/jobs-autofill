import { detectAts } from '~/core/ats'
import type { AtsName } from '~/field/types'

export type SubmitDetectionOutcome = 'success' | 'failure' | 'unknown'

const SUCCESS_TEXT_PATTERNS = [
  /\bthank(\s|s)\s+you\b/i,
  /application\s+(received|submitted|complete)/i,
  /we['']?ll\s+be\s+in\s+touch/i,
  /we\s+have\s+received\s+your\s+application/i,
  /successfully\s+submitted/i,
]

const SUCCESS_URL_PATTERNS = [
  /\/(thank|thanks|confirmation|confirmed|submitted|success)(\/|$|\?)/i,
]

const WAIT_AFTER_SUBMIT_MS = 3000

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms))

const matchesSuccessText = (root: HTMLElement): boolean => {
  const text = (root.innerText ?? '').slice(0, 5000)
  return SUCCESS_TEXT_PATTERNS.some((re) => re.test(text))
}

const matchesSuccessUrl = (url: string): boolean =>
  SUCCESS_URL_PATTERNS.some((re) => re.test(url))

const formStillVisible = (form: HTMLElement | null): boolean => {
  if (!form) return false
  if (!document.documentElement.contains(form)) return false
  const rect = form.getBoundingClientRect()
  return rect.height > 0 && rect.width > 0
}

const detectGreenhouseClassic = async (
  form: HTMLElement | null,
): Promise<SubmitDetectionOutcome> => {
  const startUrl = location.href
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    if (location.href !== startUrl && matchesSuccessUrl(location.href)) {
      return 'success'
    }
    if (matchesSuccessText(document.body)) return 'success'
    if (!formStillVisible(form)) {
      await sleep(300)
      if (matchesSuccessText(document.body)) return 'success'
      return 'unknown'
    }
    await sleep(300)
  }
  return 'unknown'
}

const detectGreenhouseReact = async (
  form: HTMLElement | null,
): Promise<SubmitDetectionOutcome> => {
  const deadline = Date.now() + 6000
  while (Date.now() < deadline) {
    if (matchesSuccessText(document.body)) return 'success'
    if (!formStillVisible(form)) {
      await sleep(300)
      if (matchesSuccessText(document.body)) return 'success'
      return 'unknown'
    }
    await sleep(300)
  }
  return 'unknown'
}

const detectWorkday = async (
  form: HTMLElement | null,
): Promise<SubmitDetectionOutcome> => {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const submitted = document.querySelector(
      "[data-automation-id*='submit'], [data-automation-id*='Submitted'], [data-automation-id*='complete']",
    )
    if (submitted) {
      const text = (submitted as HTMLElement).innerText ?? ''
      if (/submitted|received|complete|thank/i.test(text)) return 'success'
    }
    if (matchesSuccessText(document.body)) return 'success'
    if (!formStillVisible(form)) {
      await sleep(300)
      if (matchesSuccessText(document.body)) return 'success'
      return 'unknown'
    }
    await sleep(300)
  }
  return 'unknown'
}

const detectGeneric = async (
  form: HTMLElement | null,
): Promise<SubmitDetectionOutcome> => {
  await sleep(WAIT_AFTER_SUBMIT_MS)
  if (matchesSuccessUrl(location.href)) return 'success'
  if (!formStillVisible(form) && matchesSuccessText(document.body)) {
    return 'success'
  }
  if (matchesSuccessText(document.body)) return 'success'
  return 'unknown'
}

export const detectSubmitOutcome = (
  form: HTMLElement | null,
  ats: AtsName = detectAts(),
): Promise<SubmitDetectionOutcome> => {
  if (ats === 'greenhouseClassic') return detectGreenhouseClassic(form)
  if (ats === 'greenhouseReact') return detectGreenhouseReact(form)
  if (ats === 'workday') return detectWorkday(form)
  return detectGeneric(form)
}
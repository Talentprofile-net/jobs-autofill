import { optionMatches, optionMatchesRelaxed } from './match'
import { setNativeInputValue } from './reactProps'
export { sleep } from './async'
import { sleep } from './async'

export const VERIFY_SETTLE_INPUT_MS = 150
export const VERIFY_SETTLE_CLICK_MS = 100
export const VERIFY_SETTLE_REACT_MS = 120
export const VERIFY_SETTLE_SELECTION_MS = 150

export const verifyTextValue = async (
  input: HTMLInputElement | HTMLTextAreaElement,
  target: string,
  settleMs: number = VERIFY_SETTLE_REACT_MS,
): Promise<boolean> => {
  await sleep(settleMs)
  if (input.value === target) return true
  if (!NUMERIC.test(input.value) || !NUMERIC.test(target)) return false
  return Number(input.value) === Number(target)
}

const NUMERIC = /^\s*[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?\s*$/i

export const writeVerifiedText = async (
  input: HTMLInputElement | HTMLTextAreaElement,
  target: string,
  write: () => void,
  settleMs: number = VERIFY_SETTLE_REACT_MS,
): Promise<boolean> => {
  const original = input.value
  write()
  if (await verifyTextValue(input, target, settleMs)) return true
  if (input.value !== original) {
    setNativeInputValue(input, original)
    input.dispatchEvent(new InputEvent('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  return false
}

export const verifySelection = async (
  readCurrent: () => string,
  candidate: string,
  settleMs: number = VERIFY_SETTLE_SELECTION_MS,
): Promise<boolean> => {
  await sleep(settleMs)
  const current = readCurrent()
  if (!current) return false
  if (optionMatches(current, candidate)) return true
  return optionMatchesRelaxed(current, candidate)
}
export const holdsFor = async (
  check: () => boolean,
  durationMs: number,
  pollMs: number,
): Promise<boolean> => {
  const deadline = Date.now() + durationMs
  while (Date.now() < deadline) {
    if (!check()) return false
    await sleep(pollMs)
  }
  return check()
}

export const waitUntil = async (
  check: () => boolean,
  timeoutMs: number,
  pollMs: number,
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return true
    await sleep(pollMs)
  }
  return check()
}

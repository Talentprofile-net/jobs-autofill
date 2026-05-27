import { optionMatches, optionMatchesRelaxed } from './match'
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
  const inputNum = parseFloat(input.value)
  const targetNum = parseFloat(target)
  if (
    Number.isFinite(inputNum) &&
    Number.isFinite(targetNum) &&
    inputNum === targetNum
  ) {
    return true
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
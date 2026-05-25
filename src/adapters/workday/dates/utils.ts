import { createKeyboardEvent } from '~/core/events'
import { setNativeInputValue } from '~/core/reactProps'
import { padToWidth } from '~/core/padToWidth'

export const fillDatePart = (
  el: HTMLInputElement,
  value: string,
): void => {
  const n = parseInt(value, 10)
  if (!Number.isFinite(n) || n < 0) return
  const placeholder = el.getAttribute('placeholder') ?? ''
  const width = placeholder.length > 0 ? placeholder.length : value.length

  const useArrowDown = n === 1
  const startN = useArrowDown ? n + 1 : n - 1
  const arrowKey = useArrowDown ? 'ArrowDown' : 'ArrowUp'

  setNativeInputValue(el, padToWidth(startN.toString(), width))
  el.dispatchEvent(new InputEvent('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.dispatchEvent(createKeyboardEvent('keydown', arrowKey))
  el.click()
}
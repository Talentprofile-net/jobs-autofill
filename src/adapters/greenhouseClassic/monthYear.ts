import fieldFillerQueue from '~/core/asyncQueue'
import { getElement, getElements } from '~/core/getElements'
import { setNativeInputValue } from '~/core/reactProps'
import { padToWidth } from '~/core/padToWidth'
import { isValidMonth, isValidYear } from '~/core/dateValidation'
import { widthFor } from '~/core/dateUtils'
import { sleep } from '~/core/async'
import { GreenhouseBaseInput } from './GreenhouseBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'

const VERIFY_SETTLE_MS = 100

const MONTH_HINT_RE = /\b(mm|m|month|месяц|mois|monat|mes)\b/i
const YEAR_HINT_RE = /\b(yyyy|yy|y|year|год|annee|année|jahr|año|ano)\b/i

const identifyPart = (input: HTMLInputElement): 'month' | 'year' | null => {
  const sources = [
    input.getAttribute('placeholder') ?? '',
    input.getAttribute('aria-label') ?? '',
    input.getAttribute('name') ?? '',
    input.getAttribute('id') ?? '',
  ]
  for (const src of sources) {
    if (!src) continue
    if (MONTH_HINT_RE.test(src)) return 'month'
    if (YEAR_HINT_RE.test(src)) return 'year'
  }
  const maxLen = input.maxLength
  if (maxLen === 2) return 'month'
  if (maxLen === 4) return 'year'
  return null
}

export class MonthYear extends GreenhouseBaseInput {
  static XPATH = xpaths.MONTH_YEAR
  override fieldType = 'MonthYear'

  private get partInputs(): {
    month: HTMLInputElement | null
    year: HTMLInputElement | null
  } {
    const inputs = getElements(this.element, `.//input[@type="text"]`) as HTMLInputElement[]
    let month: HTMLInputElement | null = null
    let year: HTMLInputElement | null = null
    for (const input of inputs) {
      const kind = identifyPart(input)
      if (kind === 'month' && !month) month = input
      else if (kind === 'year' && !year) year = input
    }
    return { month, year }
  }

  currentValue(): [string, string] {
    const { month, year } = this.partInputs
    return [month?.value ?? '', year?.value ?? '']
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'date' || !value.month) return false
    if (!isValidMonth(value.month) || !isValidYear(value.year)) return false
    const { month: m, year: y } = this.partInputs
    if (!m || !y) return false
    const targetMonth = padToWidth(value.month, widthFor(m, 2))
    const targetYear = padToWidth(value.year, widthFor(y, 4))
    return fieldFillerQueue.enqueue(async () => {
      m.focus()
      setNativeInputValue(m, targetMonth)
      m.dispatchEvent(new InputEvent('input', { bubbles: true }))
      m.dispatchEvent(new Event('change', { bubbles: true }))
      y.focus()
      setNativeInputValue(y, targetYear)
      y.dispatchEvent(new InputEvent('input', { bubbles: true }))
      y.dispatchEvent(new Event('change', { bubbles: true }))
      await sleep(VERIFY_SETTLE_MS)
      const monthOk = m.value === targetMonth || m.value === value.month
      const yearOk = y.value === targetYear || y.value === value.year
      return monthOk && yearOk
    })
  }
}
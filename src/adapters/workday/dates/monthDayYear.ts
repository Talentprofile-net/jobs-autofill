import fieldFillerQueue from '~/core/asyncQueue'
import { getElement } from '~/core/getElements'
import { padToWidth } from '~/core/padToWidth'
import { isValidDay, isValidMonth, isValidYear } from '~/core/dateValidation'
import { widthFor } from '~/core/dateUtils'
import { WorkdayBaseInput } from '../WorkdayBaseInput'
import { xpaths } from '../xpaths'
import { fillDatePart } from './utils'
import type { ProfileValue } from '~/field/types'

const VERIFY_SETTLE_MS = 100

export class MonthDayYear extends WorkdayBaseInput {
  static XPATH = xpaths.MONTH_DAY_YEAR
  override fieldType = 'MonthDayYear'

  private get monthInputElement(): HTMLInputElement | null {
    return getElement(this.element, ".//input[@aria-label='Month']") as HTMLInputElement | null
  }

  private get dayInputElement(): HTMLInputElement | null {
    return getElement(this.element, ".//input[@aria-label='Day']") as HTMLInputElement | null
  }

  private get yearInputElement(): HTMLInputElement | null {
    return getElement(this.element, ".//input[@aria-label='Year']") as HTMLInputElement | null
  }

  currentValue(): [string, string, string] {
    return [
      this.monthInputElement?.value ?? '',
      this.dayInputElement?.value ?? '',
      this.yearInputElement?.value ?? '',
    ]
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'date' || !value.month || !value.day) return false
    if (
      !isValidMonth(value.month) ||
      !isValidDay(value.day) ||
      !isValidYear(value.year)
    )
      return false
    const m = this.monthInputElement
    const d = this.dayInputElement
    const y = this.yearInputElement
    if (!m || !d || !y) return false
    const targetMonth = padToWidth(value.month, widthFor(m, 2))
    const targetDay = padToWidth(value.day, widthFor(d, 2))
    const targetYear = padToWidth(value.year, widthFor(y, 4))
    let success = false
    await fieldFillerQueue.enqueue(async () => {
      await fillDatePart(m, value.month!)
      await fillDatePart(d, value.day!)
      await fillDatePart(y, value.year)
      await new Promise((r) => setTimeout(r, VERIFY_SETTLE_MS))
      const monthOk = m.value === targetMonth || m.value === value.month
      const dayOk = d.value === targetDay || d.value === value.day
      const yearOk = y.value === targetYear || y.value === value.year
      success = monthOk && dayOk && yearOk
    })
    return success
  }
}
import fieldFillerQueue from '~/core/asyncQueue'
import { getElement } from '~/core/getElements'
import { padToWidth } from '~/core/padToWidth'
import { isValidYear } from '~/core/dateValidation'
import { widthFor } from '~/core/dateUtils'
import { sleep } from '~/core/async'
import { WorkdayBaseInput } from '../WorkdayBaseInput'
import { xpaths } from '../xpaths'
import { fillDatePart } from './utils'
import type { ProfileValue } from '~/field/types'

const VERIFY_SETTLE_MS = 100

export class Year extends WorkdayBaseInput {
  static XPATH = xpaths.YEAR
  override fieldType = 'Year'

  private get yearInputElement(): HTMLInputElement | null {
    return getElement(this.element, ".//input[@aria-label='Year']") as HTMLInputElement | null
  }

  currentValue(): string {
    return this.yearInputElement?.value ?? ''
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'date') return false
    if (!isValidYear(value.year)) return false
    const y = this.yearInputElement
    if (!y) return false
    const targetYear = padToWidth(value.year, widthFor(y, 4))
    return fieldFillerQueue.enqueue(async () => {
      fillDatePart(y, value.year)
      await sleep(VERIFY_SETTLE_MS)
      return y.value === targetYear || y.value === value.year
    })
  }
}
import fieldFillerQueue from '~/core/asyncQueue'
import { setNativeInputValue } from '~/core/reactProps'
import { padToWidth } from '~/core/padToWidth'
import { isValidDay, isValidMonth, isValidYear } from '~/core/dateValidation'
import { PART_MARKER_ATTR, widthFor } from '~/core/dateUtils'
import { GenericBaseField } from './GenericBaseField'
import { resolveLabel } from './labelResolver'
import { groupLabelWithContainerFallback } from './groupLabel'
import type { DatePart } from './dateGroups'
import type { ProfileValue } from '~/field/types'

const VERIFY_SETTLE_MS = 100

const fillPart = (input: HTMLInputElement, value: string): void => {
  input.focus()
  setNativeInputValue(input, value)
  input.dispatchEvent(new InputEvent('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  input.dispatchEvent(new Event('blur', { bubbles: true }))
}

export class GenericDateGroup extends GenericBaseField {
  override fieldType = 'MonthDayYear'

  private parts: Record<DatePart, HTMLInputElement | null>
  private hasDay: boolean
  private container: HTMLElement

  constructor(
    anchor: HTMLInputElement,
    parts: Record<DatePart, HTMLInputElement | null>,
    container: HTMLElement,
  ) {
    super(anchor)
    this.parts = parts
    this.container = container
    this.hasDay = parts.day !== null
    if (!this.hasDay) {
      this.fieldType = 'MonthYear'
    }
    for (const part of [parts.month, parts.day, parts.year]) {
      if (part && part !== anchor) {
        part.setAttribute(PART_MARKER_ATTR, this.uuid)
      }
    }
  }

  override destroy(): void {
    for (const part of [this.parts.month, this.parts.day, this.parts.year]) {
      if (part && part.getAttribute(PART_MARKER_ATTR) === this.uuid) {
        part.removeAttribute(PART_MARKER_ATTR)
      }
    }
    super.destroy()
  }

  override get fieldName(): string {
    const containerLabel = resolveLabel(this.container)
    if (containerLabel) return containerLabel
    return groupLabelWithContainerFallback(this.element as HTMLInputElement)
  }

  currentValue(): string[] {
    return [
      this.parts.month?.value ?? '',
      this.parts.day?.value ?? '',
      this.parts.year?.value ?? '',
    ]
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'date') return false
    if (!value.month) return false
    if (!isValidMonth(value.month)) return false
    if (this.hasDay && !value.day) return false
    if (this.hasDay && value.day && !isValidDay(value.day)) return false
    if (!isValidYear(value.year)) return false

    const monthEl = this.parts.month
    const yearEl = this.parts.year
    if (!monthEl || !yearEl) return false

    let success = false
    await fieldFillerQueue.enqueue(async () => {
      const targetMonth = padToWidth(value.month!, widthFor(monthEl, 2))
      const targetYear = padToWidth(value.year, widthFor(yearEl, 4))

      fillPart(monthEl, targetMonth)
      if (this.hasDay && value.day && this.parts.day) {
        const targetDay = padToWidth(value.day, widthFor(this.parts.day, 2))
        fillPart(this.parts.day, targetDay)
      }
      fillPart(yearEl, targetYear)

      await new Promise((r) => setTimeout(r, VERIFY_SETTLE_MS))

      const monthOk =
        monthEl.value === targetMonth || monthEl.value === value.month
      const yearOk =
        yearEl.value === targetYear || yearEl.value === value.year
      const dayOk =
        !this.hasDay ||
        !value.day ||
        !this.parts.day ||
        this.parts.day.value === padToWidth(value.day, widthFor(this.parts.day, 2)) ||
        this.parts.day.value === value.day
      success = monthOk && yearOk && dayOk
    })
    return success
  }
}
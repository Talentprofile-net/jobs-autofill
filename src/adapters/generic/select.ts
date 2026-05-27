import fieldFillerQueue from '~/core/asyncQueue'
import { findOption } from '~/core/match'
import { planSelection, verifySelectedSet } from '~/core/multiChoiceSelection'
import { GenericBaseField } from './GenericBaseField'
import type { ProfileValue } from '~/field/types'

export class GenericSelect extends GenericBaseField {
  override fieldType = 'SimpleDropdown'

  static SELECTOR = 'select'

  constructor(element: HTMLElement) {
    super(element)
    if ((element as HTMLSelectElement).multiple) {
      this.fieldType = 'MultiSelect'
      this.destructiveByDefault = false
    }
  }

  get selectElement(): HTMLSelectElement {
    return this.element as HTMLSelectElement
  }

  currentValue(): string | string[] {
    if (this.selectElement.multiple) {
      return Array.from(this.selectElement.selectedOptions).map((o) => o.text)
    }
    return this.selectElement.selectedOptions[0]?.text ?? ''
  }

  private async fillSingle(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice') return false
    const select = this.selectElement
    const candidates = [value.preferred, ...value.fallbacks]
    const options = Array.from(select.options)
    return fieldFillerQueue.enqueue(async () => {
      for (const candidate of candidates) {
        const option = findOption(options, (o) => o.text, candidate)
        if (option) {
          if (select.selectedIndex === option.index) return true
          select.selectedIndex = option.index
          select.dispatchEvent(new Event('input', { bubbles: true }))
          select.dispatchEvent(new Event('change', { bubbles: true }))
          return select.selectedIndex === option.index
        }
      }
      return false
    })
  }

  private async fillMulti(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice' && value.kind !== 'multiChoice') return false
    const select = this.selectElement
    const options = Array.from(select.options)
    if (options.length === 0) return false

    return fieldFillerQueue.enqueue(async () => {
      const selected = options.filter((o) => o.selected)
      const hasExisting = selected.length > 0
      const plan = planSelection(options, selected, (o) => o.text, value)

      const shouldDeselect = this.destructiveByDefault || !hasExisting

      let changed = false
      if (shouldDeselect) {
        for (const option of plan.toDeselect) {
          if (option.selected) {
            option.selected = false
            changed = true
          }
        }
      }
      for (const option of plan.toSelect) {
        if (!option.selected) {
          option.selected = true
          changed = true
        }
      }
      if (changed) {
        select.dispatchEvent(new Event('input', { bubbles: true }))
        select.dispatchEvent(new Event('change', { bubbles: true }))
      }

      if (shouldDeselect) {
        return verifySelectedSet(
          options,
          (o) => o.text,
          (o) => o.selected,
          value,
        )
      }

      const desiredTexts =
        value.kind === 'multiChoice' ? value.preferred : [value.preferred]
      return desiredTexts.every((t) =>
        options.some(
          (o) =>
            o.selected && o.text.toLowerCase().trim() === t.toLowerCase().trim(),
        ),
      )
    })
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (this.selectElement.multiple) {
      return this.fillMulti(value)
    }
    return this.fillSingle(value)
  }
}
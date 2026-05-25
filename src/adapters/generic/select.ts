import fieldFillerQueue from '~/core/asyncQueue'
import { findOption } from '~/core/match'
import { selectMatches } from '~/core/multiChoiceSelection'
import { GenericBaseField } from './GenericBaseField'
import type { ProfileValue } from '~/field/types'

export class GenericSelect extends GenericBaseField {
  override fieldType = 'SimpleDropdown'

  static SELECTOR = 'select'

  constructor(element: HTMLElement) {
    super(element)
    if ((element as HTMLSelectElement).multiple) {
      this.fieldType = 'MultiSelect'
    }
  }

  get selectElement(): HTMLSelectElement {
    return this.element as HTMLSelectElement
  }

  currentValue(): string {
    if (this.selectElement.multiple) {
      return Array.from(this.selectElement.selectedOptions)
        .map((o) => o.innerText)
        .join(', ')
    }
    return this.selectElement.selectedOptions[0]?.innerText ?? ''
  }

  private async fillSingle(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice') return false
    const select = this.selectElement
    const candidates = [value.preferred, ...value.fallbacks]
    const options = Array.from(select.options)
    let filled = false
    await fieldFillerQueue.enqueue(async () => {
      for (const candidate of candidates) {
        const option = findOption(options, (o) => o.innerText, candidate)
        if (option) {
          select.selectedIndex = option.index
          select.dispatchEvent(new Event('input', { bubbles: true }))
          select.dispatchEvent(new Event('change', { bubbles: true }))
          filled = true
          return
        }
      }
    })
    return filled
  }

  private async fillMulti(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice' && value.kind !== 'multiChoice') return false
    const select = this.selectElement
    const options = Array.from(select.options)
    if (options.length === 0) return false

    let filled = false
    await fieldFillerQueue.enqueue(async () => {
      const matched = selectMatches(options, (o) => o.innerText, value)
      if (matched.length === 0) return
      let changed = false
      for (const option of matched) {
        if (!option.selected) {
          option.selected = true
          changed = true
        }
      }
      if (!changed) return
      select.dispatchEvent(new Event('input', { bubbles: true }))
      select.dispatchEvent(new Event('change', { bubbles: true }))
      filled = true
    })
    return filled
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (this.selectElement.multiple) {
      return this.fillMulti(value)
    }
    return this.fillSingle(value)
  }
}
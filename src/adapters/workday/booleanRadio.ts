import fieldFillerQueue from '~/core/asyncQueue'
import { getElement, getElements } from '~/core/getElements'
import { findOption } from '~/core/match'
import { WorkdayBaseInput } from './WorkdayBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'

const TRUE_LABELS = ['Yes', 'True', 'Present', 'Current']
const FALSE_LABELS = ['No', 'False', 'Not current']

export class BooleanRadio extends WorkdayBaseInput {
  static XPATH = xpaths.BOOLEAN_RADIO
  override fieldType = 'BooleanRadio'

  override get fieldName(): string {
    return getElement(this.element, './/legend')?.innerText ?? ''
  }

  private get checkedRadioElement(): HTMLElement | null {
    const xpath = [
      ".//input[@type='radio'][@aria-checked='true']",
      '/ancestor::div',
      '[label]',
    ].join('')
    return getElement(this.element, xpath)
  }

  private get radioOptions(): { input: HTMLInputElement; label: string }[] {
    const wrappers = getElements(
      this.element,
      ".//div[label][.//input[@type='radio']]",
    )
    const out: { input: HTMLInputElement; label: string }[] = []
    for (const wrapper of wrappers) {
      const input = getElement(wrapper, ".//input[@type='radio']") as HTMLInputElement | null
      const labelEl = getElement(wrapper, './label')
      if (input && labelEl) {
        out.push({ input, label: labelEl.innerText })
      }
    }
    return out
  }

  currentValue(): string {
    return this.checkedRadioElement?.textContent ?? ''
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'string' && value.kind !== 'choice' && value.kind !== 'boolean') {
      return false
    }

    const candidates: string[] =
      value.kind === 'string'
        ? [value.value]
        : value.kind === 'choice'
          ? [value.preferred, ...value.fallbacks]
          : value.value
            ? TRUE_LABELS
            : FALSE_LABELS

    let filled = false
    await fieldFillerQueue.enqueue(async () => {
      const options = this.radioOptions
      for (const candidate of candidates) {
        const match = findOption(options, (o) => o.label, candidate)
        if (match) {
          match.input.click()
          filled = true
          return
        }
      }
    })
    return filled
  }
}
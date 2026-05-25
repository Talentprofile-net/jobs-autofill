import fieldFillerQueue from '~/core/asyncQueue'
import { selectMatches } from '~/core/multiChoiceSelection'
import { GenericBaseField } from './GenericBaseField'
import { resolveLabel } from './labelResolver'
import { groupLabel } from './groupLabel'
import type { ProfileValue } from '~/field/types'

const VERIFY_SETTLE_MS = 100

type Choice = { input: HTMLInputElement; text: string }

const checkboxLabel = (cb: HTMLInputElement): string => {
  const direct = resolveLabel(cb)
  if (direct) return direct
  const value = cb.value
  if (value && value !== 'on') return value
  const ariaLabel = cb.getAttribute('aria-label')?.trim()
  if (ariaLabel) return ariaLabel
  const title = cb.getAttribute('title')?.trim()
  if (title) return title
  return ''
}

export class GenericCheckboxMulti extends GenericBaseField {
  override fieldType = 'MultiCheckbox'

  private inputs: HTMLInputElement[]

  constructor(anchor: HTMLInputElement, inputs: HTMLInputElement[]) {
    super(anchor)
    this.inputs = inputs
  }

  override get fieldName(): string {
    return groupLabel(this.element as HTMLInputElement) || super.fieldName
  }

  private get choices(): Choice[] {
    return this.inputs
      .map((input) => ({ input, text: checkboxLabel(input) }))
      .filter((c) => c.text)
  }

  currentValue(): string {
    return this.choices
      .filter((c) => c.input.checked)
      .map((c) => c.text)
      .join(', ')
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice' && value.kind !== 'multiChoice') return false
    const choices = this.choices
    if (choices.length === 0) return false

    let success = false
    await fieldFillerQueue.enqueue(async () => {
      const matched = selectMatches(choices, (c) => c.text, value)
      if (matched.length === 0) return

      for (const m of matched) {
        if (!m.input.checked) {
          m.input.click()
          await new Promise((r) => setTimeout(r, 0))
        }
      }

      await new Promise((r) => setTimeout(r, VERIFY_SETTLE_MS))
      success = matched.every((m) => m.input.checked)
    })
    return success
  }
}
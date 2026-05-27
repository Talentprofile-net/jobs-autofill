import fieldFillerQueue from '~/core/asyncQueue'
import { planSelection, verifySelectedSet } from '~/core/multiChoiceSelection'
import { sleep } from '~/core/async'
import { GenericBaseField } from './GenericBaseField'
import { resolveOptionLabel } from './labelResolver'
import { groupLabel } from './groupLabel'
import type { ProfileValue } from '~/field/types'

const VERIFY_SETTLE_MS = 100

type Choice = { input: HTMLInputElement; text: string }

const checkboxLabel = (cb: HTMLInputElement): string => {
  const direct = resolveOptionLabel(cb)
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
  override destructiveByDefault = false

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

  currentValue(): string[] {
    return this.choices
      .filter((c) => c.input.checked)
      .map((c) => c.text)
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice' && value.kind !== 'multiChoice') return false
    const choices = this.choices
    if (choices.length === 0) return false

    return fieldFillerQueue.enqueue(async () => {
      const selected = choices.filter((c) => c.input.checked)
      const hasExisting = selected.length > 0
      const plan = planSelection(choices, selected, (c) => c.text, value)

      const shouldDeselect = this.destructiveByDefault || !hasExisting

      if (shouldDeselect) {
        for (const choice of plan.toDeselect) {
          if (choice.input.checked) {
            choice.input.click()
            await sleep(0)
          }
        }
      }
      for (const choice of plan.toSelect) {
        if (!choice.input.checked) {
          choice.input.click()
          await sleep(0)
        }
      }

      await sleep(VERIFY_SETTLE_MS)

      if (shouldDeselect) {
        return verifySelectedSet(
          choices,
          (c) => c.text,
          (c) => c.input.checked,
          value,
        )
      }

      const desiredTexts =
        value.kind === 'multiChoice' ? value.preferred : [value.preferred]
      const currentNow = this.currentValue()
      return desiredTexts.every((t) =>
        currentNow.some(
          (c) => c.toLowerCase().trim() === t.toLowerCase().trim(),
        ),
      )
    })
  }
}
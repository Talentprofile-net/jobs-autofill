import fieldFillerQueue from '~/core/asyncQueue'
import { getElement, getElements } from '~/core/getElements'
import { planSelection, verifySelectedSet } from '~/core/multiChoiceSelection'
import { sleep } from '~/core/async'
import { GreenhouseBaseInput } from './GreenhouseBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'

const VERIFY_SETTLE_MS = 80

type Choice = { input: HTMLInputElement; label: HTMLElement; text: string }

export class Checkboxes extends GreenhouseBaseInput {
  static XPATH = xpaths.MULTI_CHECKBOX
  override fieldType = 'MultiCheckbox'

  override get fieldName(): string {
    const directLabel = getElement(this.element, "./label[normalize-space(text())]")
    if (directLabel?.innerText?.trim()) return directLabel.innerText.trim()
    return super.fieldName
  }

  private get choices(): Choice[] {
    const labels = getElements(
      this.element,
      ".//label[.//input[@type='checkbox']]",
    )
    const out: Choice[] = []
    for (const labelEl of labels) {
      const input = getElement(labelEl, ".//input[@type='checkbox']") as HTMLInputElement | null
      if (!input) continue
      out.push({ input, label: labelEl, text: labelEl.innerText })
    }
    return out
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
      const plan = planSelection(choices, selected, (c) => c.text, value)

      for (const choice of plan.toDeselect) {
        if (choice.input.checked) choice.label.click()
      }
      for (const choice of plan.toSelect) {
        if (!choice.input.checked) choice.label.click()
      }

      await sleep(VERIFY_SETTLE_MS)

      return verifySelectedSet(
        choices,
        (c) => c.text,
        (c) => c.input.checked,
        value,
      )
    })
  }
}
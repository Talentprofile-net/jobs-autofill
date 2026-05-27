import fieldFillerQueue from '~/core/asyncQueue'
import { getElement, getElements } from '~/core/getElements'
import { scrollBack } from '~/core/scroll'
import { planSelection, verifySelectedSet } from '~/core/multiChoiceSelection'
import { sleep } from '~/core/async'
import { WorkdayBaseInput } from './WorkdayBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'

const VERIFY_SETTLE_MS = 80

const DISABILITY_AUTOMATION_ID_SUFFIX = '-disability'
const DISABILITY_FIELD_NAME = 'disability'

type Choice = { input: HTMLInputElement; label: string }

export class CheckboxesSingle extends WorkdayBaseInput {
  static XPATH = xpaths.MULTI_CHECKBOX
  override fieldType = 'MultiCheckbox'

  override get fieldName(): string {
    const id = this.element.getAttribute('data-automation-id') ?? ''
    if (id.endsWith(DISABILITY_AUTOMATION_ID_SUFFIX)) return DISABILITY_FIELD_NAME
    return super.fieldName
  }

  private get choices(): Choice[] {
    const cells = getElements(this.element, ".//div[@role='cell']")
    const out: Choice[] = []
    for (const cell of cells) {
      const input = getElement(cell, ".//input[@type='checkbox']") as HTMLInputElement | null
      const labelEl = getElement(cell, './/label')
      if (input && labelEl) {
        out.push({ input, label: labelEl.innerText })
      }
    }
    return out
  }

  currentValue(): string[] {
    return this.choices
      .filter((c) => c.input.checked)
      .map((c) => c.label)
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice' && value.kind !== 'multiChoice') return false

    return scrollBack(
      async () => {
        return fieldFillerQueue.enqueue(async () => {
          const choices = this.choices
          if (choices.length === 0) return false

          const selected = choices.filter((c) => c.input.checked)
          const plan = planSelection(choices, selected, (c) => c.label, value)

          for (const choice of plan.toDeselect) {
            if (choice.input.checked) choice.input.click()
          }
          for (const choice of plan.toSelect) {
            if (!choice.input.checked) choice.input.click()
          }

          await sleep(VERIFY_SETTLE_MS)

          return verifySelectedSet(
            choices,
            (c) => c.label,
            (c) => c.input.checked,
            value,
          )
        })
      },
      { element: this.element },
    )
  }
}
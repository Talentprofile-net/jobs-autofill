import fieldFillerQueue from '~/core/asyncQueue'
import { getElement, getElements } from '~/core/getElements'
import { selectMatches } from '~/core/multiChoiceSelection'
import { GreenhouseBaseInput } from './GreenhouseBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'

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

  currentValue(): string {
    return this.choices
      .filter((c) => c.input.checked)
      .map((c) => c.text)
      .join(', ')
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice' && value.kind !== 'multiChoice') return false
    const choices = this.choices

    let filled = false
    await fieldFillerQueue.enqueue(async () => {
      const matched = selectMatches(choices, (c) => c.text, value)
      if (matched.length === 0) return
      let anyChanged = false
      for (const m of matched) {
        if (!m.input.checked) {
          m.label.click()
          anyChanged = true
        }
      }
      filled = anyChanged
    })
    return filled
  }
}
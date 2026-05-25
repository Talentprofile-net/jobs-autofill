import fieldFillerQueue from '~/core/asyncQueue'
import { getElement, getElements } from '~/core/getElements'
import { scrollBack } from '~/core/scroll'
import { selectMatches } from '~/core/multiChoiceSelection'
import { WorkdayBaseInput } from './WorkdayBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'

type Choice = { input: HTMLInputElement; label: string }

export class CheckboxesSingle extends WorkdayBaseInput {
  static XPATH = xpaths.MULTI_CHECKBOX
  override fieldType = 'MultiCheckbox'

  override get fieldName(): string {
    const id = this.element.getAttribute('data-automation-id') ?? ''
    if (id.endsWith('-disability')) return 'disability'
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

  private get selectedCheckBoxElements(): HTMLElement[] {
    const xpath = [
      ".//div[@role='cell']",
      '[',
      ".//input[@type='checkbox'][@aria-checked='true']",
      ']',
    ].join('')
    return getElements(this.element, xpath)
  }

  currentValue(): string {
    return this.selectedCheckBoxElements[0]?.innerText ?? ''
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice' && value.kind !== 'multiChoice') return false

    let filled = false
    await scrollBack(
      async () => {
        await fieldFillerQueue.enqueue(async () => {
          const choices = this.choices
          const matched = selectMatches(choices, (c) => c.label, value)
          if (matched.length === 0) return
          let anyChanged = false
          for (const m of matched) {
            if (!m.input.checked) {
              m.input.click()
              anyChanged = true
            }
          }
          filled = anyChanged
        })
      },
      { element: this.element },
    )
    return filled
  }
}
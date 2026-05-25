import fieldFillerQueue from '~/core/asyncQueue'
import { getElement, getElements } from '~/core/getElements'
import { selectMatches } from '~/core/multiChoiceSelection'
import { GreenhouseReactBaseInput } from './GreenhouseReactBaseInput'
import { xpaths } from './xpaths'
import { CheckboxWrapperContainer } from './checkboxWrapper'
import type { ProfileValue } from '~/field/types'

export class CheckboxMulti extends GreenhouseReactBaseInput {
  static XPATH = xpaths.CHECKBOX_MULTI
  override fieldType = 'MultiCheckbox'

  override get labelElement(): HTMLElement | null {
    return getElement(
      this.element,
      `.//legend[starts-with(@class, "label")]`,
    )
  }

  private get choiceElements(): CheckboxWrapperContainer[] {
    return getElements(
      this.element,
      `.//div[@class="checkbox__wrapper"]`,
    ).map((el) => new CheckboxWrapperContainer(el))
  }

  currentValue(): string {
    return this.choiceElements
      .filter((c) => c.checked)
      .map((c) => c.value)
      .join(', ')
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice' && value.kind !== 'multiChoice') return false
    const choices = this.choiceElements

    let filled = false
    await fieldFillerQueue.enqueue(async () => {
      const matched = selectMatches(choices, (c) => c.value, value)
      if (matched.length === 0) return
      let anyChanged = false
      for (const m of matched) {
        if (!m.checked) {
          m.check()
          anyChanged = true
        }
      }
      filled = anyChanged
    })
    return filled
  }
}
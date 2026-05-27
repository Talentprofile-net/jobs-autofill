import fieldFillerQueue from '~/core/asyncQueue'
import { getElement, getElements } from '~/core/getElements'
import { planSelection, verifySelectedSet } from '~/core/multiChoiceSelection'
import { sleep } from '~/core/async'
import { GreenhouseReactBaseInput } from './GreenhouseReactBaseInput'
import { xpaths } from './xpaths'
import { CheckboxWrapperContainer } from './checkboxWrapper'
import type { ProfileValue } from '~/field/types'

const VERIFY_SETTLE_MS = 80

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

  currentValue(): string[] {
    return this.choiceElements
      .filter((c) => c.checked)
      .map((c) => c.value)
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice' && value.kind !== 'multiChoice') return false
    const choices = this.choiceElements
    if (choices.length === 0) return false

    return fieldFillerQueue.enqueue(async () => {
      const selected = choices.filter((c) => c.checked)
      const plan = planSelection(choices, selected, (c) => c.value, value)

      for (const choice of plan.toDeselect) {
        if (choice.checked) choice.uncheck()
      }
      for (const choice of plan.toSelect) {
        if (!choice.checked) choice.check()
      }

      await sleep(VERIFY_SETTLE_MS)

      return verifySelectedSet(
        choices,
        (c) => c.value,
        (c) => c.checked,
        value,
      )
    })
  }
}
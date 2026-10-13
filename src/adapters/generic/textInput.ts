import fieldFillerQueue from '~/core/asyncQueue'
import { setNativeInputValue } from '~/core/reactProps'
import { writeVerifiedText } from '~/core/verify'
import { fillTypeahead, typeaheadScope } from '~/core/typeahead'
import { UnsupportedFillError } from '~/field/unsupportedFill'
import { isDialCodeValue } from '~/core/match'
import { GenericBaseField } from './GenericBaseField'
import { TEXT_INPUT_SELECTOR } from './dom'
import type { ProfileValue } from '~/field/types'

const VERIFY_SETTLE_MS = 150

export class GenericTextInput extends GenericBaseField {
  override fieldType = 'TextInput'

  static SELECTOR = TEXT_INPUT_SELECTOR

  get inputElement(): HTMLInputElement {
    return this.element as HTMLInputElement
  }

  currentValue(): string {
    return this.inputElement.value ?? ''
  }

  protected override shouldOverwrite(target: ProfileValue, force: boolean = false): boolean {
    const current = this.currentValue().trim()
    if (target.kind === 'string' && isDialCodeValue(current) && !this.hasUserInteracted) {
      const wanted = target.value.replace(/[\s\-.()]/g, '')
      return wanted.startsWith(current) && wanted.length > current.length
    }
    return super.shouldOverwrite(target, force)
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'string') return false
    const input = this.inputElement
    const scope = typeaheadScope(input)
    if (scope) {
      const selected = await fieldFillerQueue.enqueue(() => fillTypeahead(input, scope, [value.value]))
      if (!selected) throw new UnsupportedFillError('no unique typeahead suggestion')
      return true
    }
    return fieldFillerQueue.enqueue(() =>
      writeVerifiedText(input, value.value, () => {
        input.focus()
        setNativeInputValue(input, value.value)
        input.dispatchEvent(new InputEvent('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        input.dispatchEvent(new Event('blur', { bubbles: true }))
      }, VERIFY_SETTLE_MS),
    )
  }
}
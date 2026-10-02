import fieldFillerQueue from '~/core/asyncQueue'
import { setNativeInputValue } from '~/core/reactProps'
import { sleep } from '~/core/async'
import { fillTypeahead, typeaheadScope } from '~/core/typeahead'
import { UnsupportedFillError } from '~/field/unsupportedFill'
import { isDialCodeValue } from '~/core/match'
import { GenericBaseField } from './GenericBaseField'
import type { ProfileValue } from '~/field/types'

const VERIFY_SETTLE_MS = 150

const TEXT_INPUT_SELECTOR = [
  "input[type='text']",
  "input[type='email']",
  "input[type='tel']",
  "input[type='url']",
  "input[type='number']",
  "input[type='search']",
  'input:not([type])',
].join(', ')

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
    return fieldFillerQueue.enqueue(async () => {
      input.focus()
      setNativeInputValue(input, value.value)
      input.dispatchEvent(new InputEvent('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      input.dispatchEvent(new Event('blur', { bubbles: true }))
      await sleep(VERIFY_SETTLE_MS)
      return input.value === value.value
    })
  }
}
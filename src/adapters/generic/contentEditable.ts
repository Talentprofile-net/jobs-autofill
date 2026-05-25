import { GenericBaseField } from './GenericBaseField'
import type { PickerMode, ProfileValue } from '~/field/types'

const SELECTOR =
  '[contenteditable="true"], [contenteditable=""], [role="textbox"]'

const TAG_BLACKLIST = new Set(['INPUT', 'TEXTAREA'])

const isContentEditableLike = (el: HTMLElement): boolean => {
  if (TAG_BLACKLIST.has(el.tagName)) return false
  if (el.isContentEditable) return true
  const role = el.getAttribute('role')
  if (role === 'textbox') return true
  return false
}

export class GenericContentEditable extends GenericBaseField {
  override fieldType = 'ContentEditable'

  static SELECTOR = SELECTOR

  static qualifies(el: HTMLElement): boolean {
    return isContentEditableLike(el)
  }

  override get pickerMode(): PickerMode {
    return 'notesOnly'
  }

  protected override canFill(): boolean {
    return false
  }

  currentValue(): string {
    return this.element.innerText ?? ''
  }

  async fill(_value: ProfileValue): Promise<boolean> {
    return false
  }
}
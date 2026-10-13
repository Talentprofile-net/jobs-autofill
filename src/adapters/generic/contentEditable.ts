import { GenericBaseField } from './GenericBaseField'
import { CONTENT_EDITABLE_SELECTOR, isContentEditableLike } from './dom'
import type { PickerMode, ProfileValue } from '~/field/types'


export class GenericContentEditable extends GenericBaseField {
  override fieldType = 'ContentEditable'

  static SELECTOR = CONTENT_EDITABLE_SELECTOR

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
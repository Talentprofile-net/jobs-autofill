import { WorkdayBaseInput } from './WorkdayBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'

export class Password extends WorkdayBaseInput {
  static XPATH = xpaths.PASSWORD_INPUT
  override fieldType = 'PasswordInput'

  protected override canFill(): boolean {
    return false
  }

  currentValue(): string {
    return ''
  }

  async fill(_value: ProfileValue): Promise<boolean> {
    return false
  }
}
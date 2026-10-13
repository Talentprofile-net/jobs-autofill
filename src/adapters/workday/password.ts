import { WorkdayBaseInput } from './WorkdayBaseInput'
import type { ProfileValue } from '~/field/types'
import { specs } from './specs'

export class Password extends WorkdayBaseInput {
  static XPATH = specs.password.xpath
  override fieldType = specs.password.fieldType
  protected override readonly spec = specs.password

  currentValue(): string {
    return ''
  }

  async fill(_value: ProfileValue): Promise<boolean> {
    return false
  }
}
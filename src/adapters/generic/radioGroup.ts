import fieldFillerQueue from '~/core/asyncQueue'
import { findOption } from '~/core/match'
import { sleep } from '~/core/async'
import { GenericBaseField } from './GenericBaseField'
import { resolveOptionLabel } from './labelResolver'
import { groupLabel } from './groupLabel'
import type { ProfileValue } from '~/field/types'

const VERIFY_SETTLE_MS = 100

const radioLabel = (radio: HTMLInputElement): string => {
  const direct = resolveOptionLabel(radio)
  if (direct) return direct
  const value = radio.value
  return value && value !== 'on' ? value : ''
}

export class GenericRadioGroup extends GenericBaseField {
  override fieldType = 'RadioGroup'

  private radios: HTMLInputElement[]

  constructor(anchor: HTMLInputElement, radios: HTMLInputElement[]) {
    super(anchor)
    this.radios = radios
  }

  override get fieldName(): string {
    return groupLabel(this.element as HTMLInputElement) || super.fieldName
  }

  currentValue(): string {
    const checked = this.radios.find((r) => r.checked)
    if (!checked) return ''
    return radioLabel(checked)
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'choice') return false
    const candidates = [value.preferred, ...value.fallbacks]
    const options = this.radios
      .map((input) => ({ input, text: radioLabel(input) }))
      .filter((o) => o.text)
    if (options.length === 0) return false

    return fieldFillerQueue.enqueue(async () => {
      for (const candidate of candidates) {
        const match = findOption(options, (o) => o.text, candidate)
        if (!match) continue
        if (match.input.checked) return true
        match.input.click()
        await sleep(VERIFY_SETTLE_MS)
        if (match.input.checked) return true
      }
      return false
    })
  }
}
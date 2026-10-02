import fieldFillerQueue from '~/core/asyncQueue'
import { findOption } from '~/core/match'
import { sleep } from '~/core/async'
import { GenericBaseField } from './GenericBaseField'
import { resolveOptionLabel } from './labelResolver'
import { groupHeading } from './groupLabel'
import { activateOption, claimParts, formOwner, isOperableOption, liveMembers, ownsMemberEvent, releaseParts } from './groupParts'
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

  constructor(anchor: HTMLInputElement) {
    super(anchor)
    claimParts(anchor, this.uuid)
  }

  private get radios(): HTMLInputElement[] {
    return liveMembers(this.element as HTMLInputElement)
  }

  override destroy(): void {
    releaseParts(this.uuid)
    super.destroy()
  }

  protected override interactionRoot(): EventTarget {
    return formOwner(this.element as HTMLInputElement)
  }

  protected override ownsInteraction(target: Element): boolean {
    return ownsMemberEvent(this.element as HTMLInputElement, target)
  }

  override isDisplayed(): boolean {
    return this.radios.some(isOperableOption)
  }

  override get fieldName(): string {
    return groupHeading(this.radios) || super.fieldName
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
        activateOption(match.input)
        await sleep(VERIFY_SETTLE_MS)
        if (match.input.checked) return true
      }
      return false
    })
  }
}
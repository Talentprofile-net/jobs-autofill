import fieldFillerQueue from '~/core/asyncQueue'
import { getElement, getElements } from '~/core/getElements'
import { findOption } from '~/core/match'
import { sleep, verifySelection } from '~/core/verify'
import { WorkdayBaseInput } from './WorkdayBaseInput'
import { xpaths } from './xpaths'
import type { ProfileValue } from '~/field/types'

const TRUE_LABELS = [
  'Yes',
  'True',
  'Present',
  'Current',
  'Oui',
  'Ja',
  'Sí',
  'Si',
  'Sì',
  'Tak',
  '是',
  'はい',
  'Да',
  'Sim',
]
const FALSE_LABELS = [
  'No',
  'False',
  'Not current',
  'Non',
  'Nein',
  'Nie',
  '否',
  'いいえ',
  'Нет',
  'Não',
]
const TRUE_VALUES = ['true', '1', 'yes', 'y', 'on']
const FALSE_VALUES = ['false', '0', 'no', 'n', 'off']
const SELECTION_SETTLE_MS = 100

type RadioOption = { input: HTMLInputElement; label: string }

const normalize = (s: string): string =>
  s.replace(/\s+/g, ' ').trim().toLowerCase()

export class BooleanRadio extends WorkdayBaseInput {
  static XPATH = xpaths.BOOLEAN_RADIO
  override fieldType = 'BooleanRadio'

  override get fieldName(): string {
    return getElement(this.element, './/legend')?.innerText ?? ''
  }

  private get radioOptions(): RadioOption[] {
    const wrappers = getElements(
      this.element,
      ".//div[label][.//input[@type='radio']]",
    )
    const out: RadioOption[] = []
    for (const wrapper of wrappers) {
      const input = getElement(wrapper, ".//input[@type='radio']") as HTMLInputElement | null
      const labelEl = getElement(wrapper, './label')
      if (input && labelEl) {
        out.push({ input, label: labelEl.innerText })
      }
    }
    return out
  }

  currentValue(): string {
    const checked = this.radioOptions.find((o) => o.input.checked)
    return checked?.label ?? ''
  }

  private findOptionByInputValue(
    options: RadioOption[],
    expectedValues: string[],
  ): RadioOption | null {
    const normalizedExpected = new Set(expectedValues.map((v) => normalize(v)))
    for (const opt of options) {
      const value = opt.input.value
      if (!value) continue
      if (normalizedExpected.has(normalize(value))) return opt
    }
    return null
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'string' && value.kind !== 'choice' && value.kind !== 'boolean') {
      return false
    }

    const candidates: string[] =
      value.kind === 'string'
        ? [value.value]
        : value.kind === 'choice'
          ? [value.preferred, ...value.fallbacks]
          : value.value
            ? TRUE_LABELS
            : FALSE_LABELS

    const options = this.radioOptions

    return fieldFillerQueue.enqueue(async () => {
      for (const candidate of candidates) {
        if (await verifySelection(() => this.currentValue(), candidate, 0)) {
          return true
        }
      }

      if (value.kind === 'boolean') {
        const expectedValues = value.value ? TRUE_VALUES : FALSE_VALUES
        const byValue = this.findOptionByInputValue(options, expectedValues)
        if (byValue) {
          byValue.input.click()
          await sleep(SELECTION_SETTLE_MS)
          if (byValue.input.checked) return true
        }
      }

      for (const candidate of candidates) {
        const match = findOption(options, (o) => o.label, candidate)
        if (!match) continue
        match.input.click()
        await sleep(SELECTION_SETTLE_MS)
        if (await verifySelection(() => this.currentValue(), candidate, 0)) {
          return true
        }
      }

      if (value.kind === 'boolean' && options.length === 2) {
        const target = value.value ? options[0] : options[1]
        if (!target.input.checked) {
          target.input.click()
          await sleep(SELECTION_SETTLE_MS)
        }
        return target.input.checked
      }

      return false
    })
  }
}
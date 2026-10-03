import type { FieldDescriptor } from '~/bridge/types'
import type { ProfileValue } from '~/field/types'
import type { DonorAppearance } from '~/ui/donorStyle'

export const PICKER_PAGE = '/picker.html'

export type PickerFieldContext = {
  kind: 'field'
  descriptor: FieldDescriptor
  optionLabels: string[] | null
  mobile: boolean
  appearance: DonorAppearance | null
  storageKey: string
  maxHeight: number
}

export type PickerConfirmContext = {
  kind: 'confirmFill'
  mobile: boolean
  appearance: DonorAppearance | null
  maxHeight: number
}

export type PickerContextData = PickerFieldContext | PickerConfirmContext

export type { InsertResult } from './insertion'

export type PickerAction =
  | { type: 'ready' }
  | { type: 'context' }
  | { type: 'insert'; text: string }
  | { type: 'fill'; value: ProfileValue }
  | { type: 'dismiss' }
  | { type: 'confirmFill' }
  | { type: 'resize'; height: number }

export type PickerRelay = { kind: 'picker.relay'; hostId: string; activation: string | null; action: PickerAction }

export type PickerSignal =
  | { kind: 'picker.activate'; hostId: string; activation: string }
  | { kind: 'picker.deactivate'; hostId: string; activation: string }
  | { kind: 'picker.layout'; hostId: string; activation: string; maxHeight: number }

export const readPickerSignal = (message: unknown, hostId: string): PickerSignal | null => {
  if (typeof message !== 'object' || message === null) return null
  const { kind, hostId: target, activation } = message as Record<string, unknown>
  if (target !== hostId || typeof activation !== 'string' || activation === '') return null
  if (kind === 'picker.activate' || kind === 'picker.deactivate') return message as PickerSignal
  if (kind === 'picker.layout' && typeof (message as { maxHeight?: unknown }).maxHeight === 'number') {
    return message as PickerSignal
  }
  return null
}

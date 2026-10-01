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
  | { type: 'context' }
  | { type: 'insert'; text: string }
  | { type: 'fill'; value: ProfileValue }
  | { type: 'dismiss' }
  | { type: 'confirmFill' }
  | { type: 'resize'; height: number }

export type PickerRelay = { kind: 'picker.relay'; sessionId: string; action: PickerAction }

export type PickerLayout = { kind: 'picker.layout'; sessionId: string; maxHeight: number }

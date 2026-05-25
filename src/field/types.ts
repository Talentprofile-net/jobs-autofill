export type ProfileValue =
  | { kind: 'string'; value: string; confidence: 'exact' | 'guess' }
  | { kind: 'choice'; preferred: string; fallbacks: string[] }
  | { kind: 'multiChoice'; preferred: string[]; fallbacks: string[] }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'date'; year: string; month?: string; day?: string }
  | { kind: 'unsupported' }
  | { kind: 'timeout' }

export type AtsName = 'workday' | 'greenhouseClassic' | 'greenhouseReact' | 'generic'

export type PickerMode = 'full' | 'notesOnly'

export type OriginMode = 'application' | 'notesOnly' | 'auto'

export type FillSkipReason =
  | 'has-value'
  | 'guess'
  | 'unsupported'
  | 'timeout'
  | 'no-match'
  | 'busy'

export type FillOutcome =
  | { status: 'filled' }
  | { status: 'skipped'; reason: FillSkipReason }
  | { status: 'failed'; error: string }
import type { ProfileValue } from '~/field/types'

const TEXT_FIELD_TYPES = new Set(['TextInput', 'ContentEditable'])

const DATE_FIELD_TYPES = new Set(['MonthDayYear', 'MonthYear', 'Year'])

const coerceDateArray = (
  strings: string[],
  fieldType: string,
): ProfileValue | null => {
  if (fieldType === 'MonthDayYear' && strings.length === 3) {
    const [month, day, year] = strings
    if (!year) return null
    return { kind: 'date', year, month, day }
  }
  if (fieldType === 'MonthYear' && strings.length === 2) {
    const [month, year] = strings
    if (!year) return null
    return { kind: 'date', year, month }
  }
  if (fieldType === 'Year' && strings.length === 1) {
    return { kind: 'date', year: strings[0] }
  }
  return null
}

const coerceDateScalar = (value: string, fieldType: string): ProfileValue | null => {
  if (fieldType !== 'Year') return null
  return { kind: 'date', year: value }
}

export const coerceToProfileValueShape = (
  current: unknown,
  fieldType: string,
): ProfileValue | null => {
  if (current === null || current === undefined) return null

  if (typeof current === 'boolean') {
    return { kind: 'boolean', value: current }
  }

  if (typeof current === 'string') {
    const trimmed = current.trim()
    if (trimmed.length === 0) return null
    if (DATE_FIELD_TYPES.has(fieldType)) {
      return coerceDateScalar(trimmed, fieldType)
    }
    if (
      fieldType === 'SimpleDropdown' ||
      fieldType === 'RadioGroup' ||
      fieldType === 'BooleanRadio'
    ) {
      return { kind: 'choice', preferred: trimmed, fallbacks: [] }
    }
    return { kind: 'string', value: trimmed, confidence: 'exact' }
  }

  if (Array.isArray(current)) {
    const strings = current
      .map((v) => String(v ?? '').trim())
      .filter((s) => s.length > 0)
    if (strings.length === 0) return null

    if (DATE_FIELD_TYPES.has(fieldType)) {
      return coerceDateArray(strings, fieldType)
    }

    if (
      fieldType === 'MultiCheckbox' ||
      fieldType === 'MultiSelect' ||
      fieldType === 'MultiSearchableDropdown'
    ) {
      return { kind: 'multiChoice', preferred: strings, fallbacks: [] }
    }

    return { kind: 'choice', preferred: strings[0], fallbacks: strings.slice(1) }
  }

  return null
}

export const profileValueToText = (v: ProfileValue): string | null => {
  if (v.kind === 'string') return v.value
  if (v.kind === 'boolean') return v.value ? 'true' : 'false'
  if (v.kind === 'choice') return v.preferred
  if (v.kind === 'multiChoice') return v.preferred.join(', ')
  if (v.kind === 'date') {
    if (v.month && v.day) return `${v.year}-${v.month}-${v.day}`
    if (v.month) return `${v.year}-${v.month}`
    return v.year
  }
  return null
}

export const profileValueKind = (v: ProfileValue): string => v.kind
import type { Profile } from '~/api/types'
import type { ProfileValue } from '~/field/types'
import { resolveField } from './profileResolver'
import type { StandardField } from './standardField'

const PROFILE_QUESTION: Record<StandardField, string> = {
  'address-level1': 'State',
  'address-level2': 'City',
  country: 'Country',
  email: 'Email',
  'family-name': 'Last name',
  github: 'GitHub',
  'given-name': 'First name',
  linkedin: 'LinkedIn',
  name: 'Full name',
  'organization-title': 'Current title',
  tel: 'Phone',
}

const FIELD_TYPES: Record<StandardField, ReadonlySet<string>> = {
  'address-level1': new Set(['TextInput', 'SimpleDropdown']),
  'address-level2': new Set(['TextInput', 'SimpleDropdown']),
  country: new Set(['TextInput', 'SimpleDropdown']),
  email: new Set(['TextInput']),
  'family-name': new Set(['TextInput']),
  github: new Set(['TextInput']),
  'given-name': new Set(['TextInput']),
  linkedin: new Set(['TextInput']),
  name: new Set(['TextInput']),
  'organization-title': new Set(['TextInput']),
  tel: new Set(['TextInput']),
}

export const standardFieldValue = (field: StandardField, fieldType: string, profile: Profile): ProfileValue | null => {
  if (!FIELD_TYPES[field].has(fieldType)) return null
  const { value } = resolveField(PROFILE_QUESTION[field], fieldType, '', profile)
  if (value.kind === 'string' && value.confidence !== 'exact') return null
  return value.kind === 'unsupported' ? null : value
}

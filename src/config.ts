export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8083'
export const TOKEN_STORAGE_KEY = 'tp.tokens'
export const FIELD_MARKER_ATTR = 'data-tp-field'
export const BRIDGE_MAGIC = 'tp:bridge'
export const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000

export const WEB_APP_BASE_URL = import.meta.env.VITE_WEB_APP_URL ?? 'https://talentprofile.net'
export const WEB_APP_DASHBOARD_URL = import.meta.env.VITE_WEB_APP_DASHBOARD_URL ?? 'https://app.talentprofile.net'
export const EXTENSION_CONNECT_PATH = '/auth/extension'

export const PROFILE_SCORE_EMPTY_BELOW = 25
export const PROFILE_SCORE_COMPLETE_AT = 70

export const APPLICATION_KEYWORDS: string[] = [
  'resume',
  'curriculum vitae',
  'cv',
  'cover letter',
  'work authorization',
  'employment history',
  'work history',
  'employment eligibility',
  'visa sponsorship',
  'desired salary',
  'expected salary',
  'years of experience',
  'job application',
  'apply for',
  'how did you hear',
  'eeo',
  'equal opportunity',
  'voluntary self-identification',
  'disability status',
  'veteran status',
]
export const APPLICATION_MIN_FIELD_COUNT = 3
export const normalizeOption = (value: string): string =>
  value.replace(/\s+/g, ' ').trim().toLowerCase()

export const optionMatches = (optionText: string, candidate: string): boolean =>
  normalizeOption(optionText) === normalizeOption(candidate)

const stripParenthetical = (s: string): string =>
  s.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()

const beforeFirstComma = (s: string): string => {
  const idx = s.indexOf(',')
  return idx >= 0 ? s.slice(0, idx).trim() : s
}

const stripRemoveMarker = (s: string): string => {
  return s.replace(/\u00d7/g, '').trim()
}

const tokenize = (s: string): string[] =>
  s.split(/\s+/).filter((t) => t.length > 0)

/**
 * Relaxed option matching for use as a *fallback* only.
 *
 * Tries, in order:
 *   1. exact normalized equality
 *   2. equality after stripping parentheticals and text after first comma
 *      (handles "Thailand (TH)" vs "Thailand", "Yes, I am willing" vs "Yes")
 *
 * Substring/token-containment matching has been removed to avoid false
 * positives like "York" matching "New York" or "United States" matching
 * "United States Permanent Resident".
 *
 * Use only when exact matching has failed.
 */
export const optionMatchesRelaxed = (optionText: string, candidate: string): boolean => {
  const a = normalizeOption(stripRemoveMarker(optionText))
  const b = normalizeOption(stripRemoveMarker(candidate))
  if (!a || !b) return false
  if (a === b) return true

  const aStripped = normalizeOption(stripParenthetical(beforeFirstComma(a)))
  const bStripped = normalizeOption(stripParenthetical(beforeFirstComma(b)))
  if (aStripped && bStripped && aStripped === bStripped) return true

  if (aStripped && b && aStripped === b) return true
  if (bStripped && a && bStripped === a) return true

  return false
}

/**
 * Find a matching option in a list, trying exact match across all options
 * first, then relaxed match if no exact match was found.
 */
export const findOption = <T>(
  options: T[],
  getText: (option: T) => string,
  candidate: string,
): T | null => {
  const exact = options.find((o) => optionMatches(getText(o), candidate))
  if (exact) return exact
  return options.find((o) => optionMatchesRelaxed(getText(o), candidate)) ?? null
}

export const xpathLiteral = (value: string): string => {
  if (!value.includes("'")) return `'${value}'`
  if (!value.includes('"')) return `"${value}"`
  const parts = value.split("'").map((p) => `'${p}'`)
  return `concat(${parts.join(`, "'", `)})`
}

const EXACT_PLACEHOLDERS = new Set([
  '',
  'n/a',
  'na',
  'not specified',
  'not selected',
  'no selection',
  'none',
  'nothing selected',
  '--',
  '---',
  '—',
  '–',
  '-',
])

const PLACEHOLDER_PREFIXES = [
  'select ',
  'please select',
  'choose ',
  'please choose',
  'pick ',
  'please pick',
  '-- select',
  '-- choose',
  '— select',
  '— choose',
]

const ONLY_DASHES_OR_DOTS = /^[\s\-_—–.]+$/

export const isPlaceholderText = (value: string): boolean => {
  const normalized = value.replace(/\s+/g, ' ').trim().toLowerCase()
  if (EXACT_PLACEHOLDERS.has(normalized)) return true
  if (ONLY_DASHES_OR_DOTS.test(normalized)) return true
  for (const prefix of PLACEHOLDER_PREFIXES) {
    if (normalized.startsWith(prefix)) return true
  }
  if (normalized === 'select' || normalized === 'choose' || normalized === 'pick') {
    return true
  }
  return false
}
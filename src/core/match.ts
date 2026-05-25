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

/**
 * Relaxed option matching for use as a *fallback* only.
 *
 * Tries, in order:
 *   1. exact normalized equality
 *   2. either side starts with the other (after normalize)
 *   3. either side contains the other as a whole token (after normalize)
 *   4. equality after stripping parentheticals and text after first comma
 *
 * Designed for ATS dropdowns where labels often append extra context:
 *   "United States" vs "United States of America"
 *   "Thailand" vs "Thailand (TH)"
 *   "Yes" vs "Yes, I am willing to relocate"
 *
 * False-positive risk: aggressive matching could match "Singapore" against
 * "Singapore, Republic of" but also against "Singapore Permanent Resident".
 * Use only when exact matching has failed.
 */
export const optionMatchesRelaxed = (optionText: string, candidate: string): boolean => {
  const a = normalizeOption(stripRemoveMarker(optionText))
  const b = normalizeOption(stripRemoveMarker(candidate))
  if (!a || !b) return false
  if (a === b) return true

  if (a.startsWith(b + ' ') || b.startsWith(a + ' ')) return true
  if (a.startsWith(b + ',') || b.startsWith(a + ',')) return true

  const aTokens = ` ${a} `
  const bTokens = ` ${b} `
  if (aTokens.includes(bTokens) || bTokens.includes(aTokens)) return true

  const aStripped = normalizeOption(stripParenthetical(beforeFirstComma(a)))
  const bStripped = normalizeOption(stripParenthetical(beforeFirstComma(b)))
  if (aStripped && bStripped && aStripped === bStripped) return true

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

const COMMON_PLACEHOLDERS = new Set([
  '',
  'select one',
  'select an option',
  'select...',
  'select',
  'please select',
  'please select one',
  'please select an option',
  'choose one',
  'choose an option',
  'choose...',
  'choose',
  'pick one',
  'pick an option',
  '--',
  '---',
  '—',
  '-',
  'n/a',
  'not specified',
])

export const isPlaceholderText = (value: string): boolean => {
  const normalized = value.replace(/\s+/g, ' ').trim().toLowerCase()
  return COMMON_PLACEHOLDERS.has(normalized)
}
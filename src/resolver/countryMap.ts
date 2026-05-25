import countries from 'i18n-iso-countries'
import enLocale from 'i18n-iso-countries/langs/en.json'

countries.registerLocale(enLocale)

export type CountryInfo = {
  alpha2: string
  alpha3: string
  englishName: string
  variants: string[]
}

const buildVariants = (alpha2: string): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (v: string | undefined): void => {
    if (!v) return
    const trimmed = v.trim()
    if (!trimmed) return
    const key = trimmed.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(trimmed)
  }
  const officialName = countries.getName(alpha2, 'en')
  push(officialName)
  const aliases = countries.getNames('en', { select: 'alias' })
  push(aliases[alpha2])
  const all = countries.getNames('en', { select: 'all' }) as Record<string, string | string[]>
  const entry = all[alpha2]
  if (Array.isArray(entry)) {
    for (const v of entry) push(v)
  } else if (typeof entry === 'string') {
    push(entry)
  }
  push(alpha2)
  const alpha3 = countries.alpha2ToAlpha3(alpha2)
  if (alpha3) push(alpha3)
  return out
}

const canonicalize = (input: string): string | null => {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    const upper = trimmed.toUpperCase()
    if (countries.isValid(upper)) return upper
  }

  if (/^[A-Za-z]{3}$/.test(trimmed)) {
    const upper = trimmed.toUpperCase()
    const alpha2 = countries.alpha3ToAlpha2(upper)
    if (alpha2) return alpha2
  }

  const byName = countries.getAlpha2Code(trimmed, 'en')
  if (byName) return byName

  return null
}

export const lookupCountry = (input: string): CountryInfo | null => {
  const alpha2 = canonicalize(input)
  if (!alpha2) return null
  const alpha3 = countries.alpha2ToAlpha3(alpha2) ?? alpha2
  const englishName = countries.getName(alpha2, 'en') ?? alpha2
  return {
    alpha2,
    alpha3,
    englishName,
    variants: buildVariants(alpha2),
  }
}

export const countryVariants = (input: string): string[] => {
  const info = lookupCountry(input)
  if (!info) return [input]
  return info.variants
}
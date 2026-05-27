import { lookupCountry, type CountryInfo } from './countryMap'

export type ParsedLocation = {
  raw: string
  country: CountryInfo | null
  city: string | null
  region: string | null
  remainder: string | null
}

const splitParts = (input: string): string[] =>
  input
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

const isBareTwoLetter = (part: string): boolean =>
  /^[A-Za-z]{2}$/.test(part.trim())

const lookupCountryAvoidingBare2Letter = (
  input: string,
): CountryInfo | null => {
  if (isBareTwoLetter(input)) return null
  return lookupCountry(input)
}

export const parseLocation = (
  input: string | null | undefined,
): ParsedLocation | null => {
  if (!input) return null
  const raw = input.trim()
  if (raw.length === 0) return null

  const parts = splitParts(raw)

  if (parts.length === 1) {
    const direct = lookupCountryAvoidingBare2Letter(raw)
    if (direct) {
      return { raw, country: direct, city: null, region: null, remainder: null }
    }
    if (isBareTwoLetter(raw)) {
      return { raw, country: null, city: null, region: raw, remainder: null }
    }
    return { raw, country: null, city: raw, region: null, remainder: null }
  }

  let country: CountryInfo | null = null
  let countryIdx = -1
  for (let i = parts.length - 1; i >= 0; i--) {
    const info = lookupCountryAvoidingBare2Letter(parts[i])
    if (info) {
      country = info
      countryIdx = i
      break
    }
  }

  if (!country) {
    let city: string | null = null
    let region: string | null = null
    let remainder: string | null = null
    if (parts.length === 2) {
      city = parts[0]
      region = parts[1]
    } else {
      region = parts[parts.length - 1]
      city = parts[parts.length - 2]
      remainder = parts.slice(0, parts.length - 2).join(', ')
    }
    return { raw, country: null, city, region, remainder }
  }

  const before = parts.slice(0, countryIdx)
  let city: string | null = null
  let region: string | null = null
  let remainder: string | null = null

  if (before.length === 1) {
    city = before[0]
  } else if (before.length === 2) {
    city = before[0]
    region = before[1]
  } else if (before.length >= 3) {
    region = before[before.length - 1]
    city = before[before.length - 2]
    remainder = before.slice(0, before.length - 2).join(', ')
  }

  return {
    raw,
    country,
    city,
    region,
    remainder: remainder ?? (before.length === 0 ? null : before.join(', ')),
  }
}
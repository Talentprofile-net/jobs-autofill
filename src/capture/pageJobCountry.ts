import { normalizeJobCountry, UNKNOWN_JOB_COUNTRY } from '~/classifier/jobCountry'
import { lookupCountry } from '~/resolver/countryMap'
import { parseLocation } from '~/resolver/parseLocation'

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : value === null || value === undefined ? [] : [value]

const field = (value: unknown, key: string): unknown =>
  value && typeof value === 'object' ? Reflect.get(value, key) : undefined

const text = (value: unknown): string | null => {
  if (typeof value === 'string') return value.trim() || null
  const name = field(value, 'name')
  return typeof name === 'string' ? name.trim() || null : null
}

const countryOf = (value: string | null): string | null => {
  if (!value) return null
  const code = normalizeJobCountry(value.toUpperCase())
  if (code !== UNKNOWN_JOB_COUNTRY) return code
  return lookupCountry(value)?.alpha2 ?? parseLocation(value)?.country?.alpha2 ?? null
}

const addressCountry = (address: unknown): string | null =>
  typeof address === 'string' ? countryOf(address) : countryOf(text(field(address, 'addressCountry')))

const isJobPosting = (node: unknown): boolean =>
  asArray(field(node, '@type')).some((type) => type === 'JobPosting')

const parse = (source: string): unknown => {
  try {
    return JSON.parse(source)
  } catch {
    return null
  }
}

export const jobCountryFromJsonLd = (sources: string[]): string => {
  const countries = new Set(
    sources
      .flatMap((source) => asArray(parse(source)))
      .flatMap((node) => [node, ...asArray(field(node, '@graph'))])
      .filter(isJobPosting)
      .flatMap((posting) => [
        ...asArray(field(posting, 'jobLocation')).map((place) => addressCountry(field(place, 'address'))),
        ...asArray(field(posting, 'applicantLocationRequirements')).map((place) => countryOf(text(place))),
      ])
      .filter((country): country is string => country !== null),
  )
  return countries.size === 1 ? [...countries][0] : UNKNOWN_JOB_COUNTRY
}

export const pageJobCountry = (doc: Document): string =>
  jobCountryFromJsonLd(
    Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).map((script) => script.textContent ?? ''),
  )

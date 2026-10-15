import { normalizeJobCountry, UNKNOWN_JOB_COUNTRY } from '~/classifier/jobCountry'
import { lookupCountry } from '~/resolver/countryMap'
import { parseLocation } from '~/resolver/parseLocation'
import { asArray, field, jobPostings, jsonLdSources, text } from './jsonLd'

const COUNTRIES_NAMED_LIKE_STATES: ReadonlySet<string> = new Set(['GE'])

const countryOf = (value: string | null): string | null => {
  if (!value) return null
  const code = normalizeJobCountry(value.toUpperCase())
  if (code !== UNKNOWN_JOB_COUNTRY) return code
  return lookupCountry(value)?.alpha2 ?? parseLocation(value)?.country?.alpha2 ?? null
}

const freeFormCountry = (value: string): string | null => {
  const country = countryOf(value)
  return country && COUNTRIES_NAMED_LIKE_STATES.has(country) && normalizeJobCountry(value.trim().toUpperCase()) !== country ? null : country
}

const addressCountry = (address: unknown): string | null =>
  typeof address === 'string' ? freeFormCountry(address) : countryOf(text(field(address, 'addressCountry')))

export const jobCountryFromJsonLd = (sources: string[]): string => {
  const countries = new Set(
    jobPostings(sources)
      .flatMap((posting) => [
        ...asArray(field(posting, 'jobLocation')).map((place) => addressCountry(field(place, 'address'))),
        ...asArray(field(posting, 'applicantLocationRequirements')).map((place) => countryOf(text(place))),
      ])
      .filter((country): country is string => country !== null),
  )
  return countries.size === 1 ? [...countries][0] : UNKNOWN_JOB_COUNTRY
}

export const pageJobCountry = (doc: Document): string => jobCountryFromJsonLd(jsonLdSources(doc))

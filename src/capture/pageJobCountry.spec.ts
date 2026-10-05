import { describe, expect, it } from 'bun:test'

import { jobCountryFromJsonLd } from './pageJobCountry'

const posting = (extra: Record<string, unknown>) =>
  JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Engineer', ...extra })

describe('jobCountryFromJsonLd', () => {
  it('reads the country from a plain address string', () => {
    expect(jobCountryFromJsonLd([posting({ jobLocation: [{ '@type': 'Place', address: 'Toronto, Ontario, Canada' }] })])).toBe('CA')
  })

  it('reads a postal address country given as a code or a name', () => {
    expect(jobCountryFromJsonLd([posting({ jobLocation: { address: { '@type': 'PostalAddress', addressCountry: 'de' } } })])).toBe('DE')
    expect(jobCountryFromJsonLd([posting({ jobLocation: { address: { addressCountry: { '@type': 'Country', name: 'United Kingdom' } } } })])).toBe('GB')
  })

  it('reads a remote job from its applicant location requirement', () => {
    expect(jobCountryFromJsonLd([posting({ applicantLocationRequirements: { '@type': 'Country', name: 'Portugal' }, jobLocationType: 'TELECOMMUTE' })])).toBe('PT')
  })

  it('finds a posting inside a graph and skips other nodes and broken scripts', () => {
    const graph = JSON.stringify({ '@graph': [{ '@type': 'Organization', address: 'Paris, France' }, JSON.parse(posting({ jobLocation: { address: 'Madrid, Spain' } }))] })
    expect(jobCountryFromJsonLd(['{not json', graph])).toBe('ES')
  })

  it('stays unknown for multi-country, missing or unparseable locations', () => {
    expect(jobCountryFromJsonLd([posting({ jobLocation: [{ address: 'Berlin, Germany' }, { address: 'Austin, TX, United States' }] })])).toBe('_unknown')
    expect(jobCountryFromJsonLd([posting({})])).toBe('_unknown')
    expect(jobCountryFromJsonLd([posting({ jobLocation: { address: 'Anywhere' } })])).toBe('_unknown')
    expect(jobCountryFromJsonLd([])).toBe('_unknown')
  })
})

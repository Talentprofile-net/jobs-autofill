import { describe, expect, it } from 'bun:test'

import { installDom } from '~/core/__fixtures__/domGlobals'
import { MAX_JOB_DESCRIPTION, htmlToText, jobFromJsonLd, pageJob, readPageJob } from './pageJob'

const posting = (extra: Record<string, unknown>) =>
  JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', ...extra })

describe('jobFromJsonLd', () => {
  it('extracts the title, the hiring company and the description as text', () => {
    const job = jobFromJsonLd([
      posting({
        description: '<p>Build <strong>APIs</strong> &amp; tools.</p><ul><li>TypeScript</li><li>Postgres</li></ul>',
        hiringOrganization: { '@type': 'Organization', name: ' Acme Corp ' },
        title: 'Senior Engineer',
      }),
    ])
    expect(job).toEqual({
      company: 'Acme Corp',
      description: 'Build APIs & tools.\n- TypeScript\n- Postgres',
      title: 'Senior Engineer',
    })
  })

  it('reads entity-escaped HTML and a company given as a string', () => {
    const job = jobFromJsonLd([posting({ description: '&lt;p&gt;We&amp;rsquo;re hiring&lt;/p&gt;&lt;br/&gt;Remote', hiringOrganization: 'Acme', title: 'Dev &amp; Ops' })])
    expect(job).toEqual({ company: 'Acme', description: 'We’re hiring\n\nRemote', title: 'Dev & Ops' })
  })

  it('caps the description', () => {
    const job = jobFromJsonLd([posting({ description: `<p>${'a'.repeat(MAX_JOB_DESCRIPTION + 500)}</p>`, title: 'Engineer' })])
    expect(job?.description?.length).toBe(MAX_JOB_DESCRIPTION)
  })

  it('uses the first described posting, also inside a graph', () => {
    const graph = JSON.stringify({ '@graph': [{ '@type': 'Organization', name: 'Acme' }, JSON.parse(posting({ title: 'From graph' }))] })
    expect(jobFromJsonLd([posting({ hiringOrganization: 'Empty' }), graph, posting({ title: 'Second' })])).toEqual({ title: 'From graph' })
  })

  it('omits missing fields and refuses a posting with neither title nor description', () => {
    expect(jobFromJsonLd([posting({ description: 'Ship it' })])).toEqual({ description: 'Ship it' })
    expect(jobFromJsonLd([posting({ hiringOrganization: 'Acme' })])).toBeNull()
    expect(jobFromJsonLd([posting({ description: 42, title: '   ' })])).toBeNull()
    expect(jobFromJsonLd([JSON.stringify({ '@type': 'Organization', name: 'Acme' })])).toBeNull()
    expect(jobFromJsonLd([])).toBeNull()
  })

  it('ignores malformed JSON', () => {
    expect(jobFromJsonLd(['{not json', posting({ title: 'Engineer' })])).toEqual({ title: 'Engineer' })
    expect(jobFromJsonLd(['{not json'])).toBeNull()
  })
})

describe('htmlToText', () => {
  it('drops scripts and styles and decodes numeric entities', () => {
    expect(htmlToText('<style>p{}</style><script>alert(1)</script>Caf&#233; &#x2014; ok&nbsp;now')).toBe('Café — ok now')
  })

  it('keeps unknown entities and collapses blank lines', () => {
    expect(htmlToText('<p>One</p>\n\n\n<p>&bogus; Two</p>')).toBe('One\n\n&bogus; Two')
  })
})

describe('pageJob', () => {
  it('adds the page URL without its fragment', () => {
    installDom(`<html><head><script type="application/ld+json">${posting({ title: 'Engineer' })}</script></head><body></body></html>`)
    expect(pageJob(document, 'https://jobs.example.test/apply/1?ref=x#form')).toEqual({ title: 'Engineer', url: 'https://jobs.example.test/apply/1?ref=x' })
  })

  it('returns nothing for a page without a job posting', () => {
    installDom('<html><body><p>Hello</p></body></html>')
    expect(pageJob(document, 'https://jobs.example.test/')).toBeNull()
  })
})

describe('readPageJob', () => {
  it('keeps only string fields, caps the description and drops a non-web URL', () => {
    expect(readPageJob({ company: 7, description: 'x'.repeat(MAX_JOB_DESCRIPTION + 1), title: 'Engineer', url: 'javascript:alert(1)' })).toEqual({
      description: 'x'.repeat(MAX_JOB_DESCRIPTION),
      title: 'Engineer',
    })
  })

  it('refuses an answer without a title or description', () => {
    expect(readPageJob(null)).toBeNull()
    expect(readPageJob('Engineer')).toBeNull()
    expect(readPageJob({ company: 'Acme', url: 'https://jobs.example.test/' })).toBeNull()
  })
})

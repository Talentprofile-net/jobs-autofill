import { asArray, field, jobPostings, jsonLdSources, text } from './jsonLd'

export type PageJob = {
  title?: string
  company?: string
  description?: string
  url?: string
}

export const MAX_JOB_DESCRIPTION = 20_000

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  bull: '•',
  gt: '>',
  hellip: '…',
  ldquo: '“',
  lsquo: '‘',
  lt: '<',
  mdash: '—',
  nbsp: ' ',
  ndash: '–',
  quot: '"',
  rdquo: '”',
  rsquo: '’',
}

const codePoint = (value: number): string | null =>
  Number.isInteger(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : null

const decodeEntities = (value: string): string =>
  value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] !== '#') return NAMED_ENTITIES[name.toLowerCase()] ?? entity
    const hex = name[1] === 'x' || name[1] === 'X'
    return codePoint(Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10)) ?? entity
  })

const stripTags = (value: string): string =>
  value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|section|article)\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]*>/g, ' ')

const collapse = (value: string): string =>
  value
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

export const htmlToText = (html: string): string => collapse(decodeEntities(stripTags(decodeEntities(stripTags(html)))))

const clean = (value: unknown, limit: number | null = null): string | undefined => {
  const raw = text(value)
  if (!raw) return undefined
  const plain = htmlToText(raw)
  const capped = limit === null ? plain : plain.slice(0, limit).trim()
  return capped || undefined
}

const compact = (job: PageJob): PageJob =>
  Object.fromEntries(Object.entries(job).filter(([, value]) => typeof value === 'string' && value !== ''))

const postingJob = (posting: unknown): PageJob => {
  const description = field(posting, 'description')
  return compact({
    company: clean(asArray(field(posting, 'hiringOrganization'))[0]),
    description: typeof description === 'string' ? clean(description, MAX_JOB_DESCRIPTION) : undefined,
    title: clean(field(posting, 'title')),
  })
}

const isDescribed = (job: PageJob): boolean => job.title !== undefined || job.description !== undefined

export const jobFromJsonLd = (sources: string[]): PageJob | null =>
  jobPostings(sources).map(postingJob).find(isDescribed) ?? null

const pageUrl = (href: string): string | undefined => {
  try {
    const url = new URL(href)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    url.hash = ''
    return url.href
  } catch {
    return undefined
  }
}

export const pageJob = (doc: Document, href: string): PageJob | null => {
  const job = jobFromJsonLd(jsonLdSources(doc))
  return job ? compact({ ...job, url: pageUrl(href) }) : null
}

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined

export const readPageJob = (value: unknown): PageJob | null => {
  const description = optionalString(field(value, 'description'))
  const job = compact({
    company: optionalString(field(value, 'company')),
    description: description?.slice(0, MAX_JOB_DESCRIPTION),
    title: optionalString(field(value, 'title')),
    url: pageUrl(optionalString(field(value, 'url')) ?? ''),
  })
  return isDescribed(job) ? job : null
}

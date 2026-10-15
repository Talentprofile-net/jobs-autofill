export const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : value === null || value === undefined ? [] : [value]

export const field = (value: unknown, key: string): unknown =>
  value && typeof value === 'object' ? Reflect.get(value, key) : undefined

export const text = (value: unknown): string | null => {
  if (typeof value === 'string') return value.trim() || null
  const name = field(value, 'name')
  return typeof name === 'string' ? name.trim() || null : null
}

const isJobPosting = (node: unknown): boolean =>
  asArray(field(node, '@type')).some((type) => type === 'JobPosting')

const parse = (source: string): unknown => {
  try {
    return JSON.parse(source)
  } catch {
    return null
  }
}

export const jobPostings = (sources: string[]): unknown[] =>
  sources
    .flatMap((source) => asArray(parse(source)))
    .flatMap((node) => [node, ...asArray(field(node, '@graph'))])
    .filter(isJobPosting)

export const jsonLdSources = (doc: Document): string[] =>
  Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).map((script) => script.textContent ?? '')

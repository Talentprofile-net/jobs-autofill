import { getElements } from '~/core/getElements'

export const SECTION_XPATH = [
  `.//div`,
  `[contains(@class, 'education--form')`,
  ` or contains(@class, 'employment--form')]`,
].join('')

const sectionTypeOf = (el: HTMLElement): string => {
  const cls = el.getAttribute('class') ?? ''
  if (cls.includes('education')) return 'education'
  if (cls.includes('employment')) return 'employment'
  return 'section'
}

export const sectionNumbers = (): Map<HTMLElement, string> => {
  const counts = new Map<string, number>()
  const out = new Map<HTMLElement, string>()
  for (const el of getElements(document, SECTION_XPATH)) {
    const type = sectionTypeOf(el)
    const index = (counts.get(type) ?? 0) + 1
    counts.set(type, index)
    out.set(el, `${type} ${index}`)
  }
  return out
}

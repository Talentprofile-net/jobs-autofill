type SectionKind = 'employment' | 'education'

const SECTION_PATTERNS: Record<SectionKind, RegExp> = {
  employment: /\b(experience|employment|work\s*history|job\s*history|professional\s*history)\b/i,
  education: /\b(education|school|university|college|academic)\b/i,
}

const findEnclosingSection = (
  el: HTMLElement,
): { kind: SectionKind; container: HTMLElement } | null => {
  let node: HTMLElement | null = el.parentElement
  while (node && node !== document.body) {
    const fieldset = node.tagName.toLowerCase() === 'fieldset' ? node : null
    const role = node.getAttribute('role')
    if (fieldset || role === 'group') {
      const legend = fieldset
        ? (fieldset.querySelector(':scope > legend') as HTMLElement | null)
        : null
      const ariaLabel = node.getAttribute('aria-label') ?? ''
      const ariaLabelledBy = node.getAttribute('aria-labelledby')
      const labelledByEl = ariaLabelledBy ? document.getElementById(ariaLabelledBy) : null
      const text =
        (legend?.innerText ?? '') +
        ' ' +
        ariaLabel +
        ' ' +
        (labelledByEl?.innerText ?? '')
      for (const kind of ['employment', 'education'] as const) {
        if (SECTION_PATTERNS[kind].test(text)) {
          return { kind, container: node }
        }
      }
    }
    node = node.parentElement
  }
  return null
}

export const inferSection = (el: HTMLElement): string => {
  const enclosing = findEnclosingSection(el)
  if (!enclosing) return ''
  const { kind, container } = enclosing
  const parent = container.parentElement
  if (!parent) return ''
  const peers = Array.from(parent.children).filter((c) => {
    if (c.tagName !== container.tagName) return false
    const sibling = c as HTMLElement
    const fieldset = sibling.tagName.toLowerCase() === 'fieldset' ? sibling : null
    const legend = fieldset
      ? (fieldset.querySelector(':scope > legend') as HTMLElement | null)
      : null
    const text =
      (legend?.innerText ?? '') +
      ' ' +
      (sibling.getAttribute('aria-label') ?? '')
    return SECTION_PATTERNS[kind].test(text)
  })
  const idx = peers.indexOf(container)
  if (idx < 0) return ''
  return `${kind} ${idx + 1}`
}
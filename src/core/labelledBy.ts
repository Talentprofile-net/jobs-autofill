import { getElementByIdInScope } from './shadowDom'

export const resolveLabelledByText = (ids: string | null, scope?: Element): string => {
  if (!ids) return ''
  const parts: string[] = []
  for (const id of ids.split(/\s+/)) {
    if (!id) continue
    const el = scope ? getElementByIdInScope(scope, id) : document.getElementById(id)
    const text = el?.innerText?.trim()
    if (text) parts.push(text)
  }
  return parts.join(' ')
}

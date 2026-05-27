export const resolveLabelledByText = (ids: string | null): string => {
  if (!ids) return ''
  const parts: string[] = []
  for (const id of ids.split(/\s+/)) {
    if (!id) continue
    const el = document.getElementById(id)
    const text = el?.innerText?.trim()
    if (text) parts.push(text)
  }
  return parts.join(' ')
}
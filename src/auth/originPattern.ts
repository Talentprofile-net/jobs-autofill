export const normalizeOriginPattern = (input: string): string | null => {
  try {
    const url = new URL(input)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return `${url.protocol}//${url.host}/*`
  } catch {
    return null
  }
}

export const originFromPattern = (pattern: string): string | null => {
  const match = /^(https?):\/\/([^/]+)\/\*$/.exec(pattern)
  if (!match) return null
  return `${match[1]}://${match[2]}`
}

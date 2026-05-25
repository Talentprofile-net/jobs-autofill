type JwtPayload = {
  exp?: number
  iat?: number
  email?: string
  sub?: string
}

const EXPIRY_SKEW_SEC = 30

const base64UrlDecode = (input: string): string => {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  const padding = padded.length % 4
  const fullyPadded = padding > 0 ? padded + '='.repeat(4 - padding) : padded
  return atob(fullyPadded)
}

export const decodeJwtPayload = (token: string): JwtPayload | null => {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const json = base64UrlDecode(parts[1])
    return JSON.parse(json) as JwtPayload
  } catch {
    return null
  }
}

/**
 * Returns true if the token is expired, malformed, or missing an `exp` claim.
 * Failure-closed: any uncertainty is treated as expired.
 */
export const isExpired = (token: string): boolean => {
  const payload = decodeJwtPayload(token)
  if (!payload) return true
  if (typeof payload.exp !== 'number') return true
  const nowSec = Math.floor(Date.now() / 1000)
  return payload.exp <= nowSec + EXPIRY_SKEW_SEC
}

export const extractEmail = (token: string): string | null => {
  const payload = decodeJwtPayload(token)
  return payload?.email ?? null
}
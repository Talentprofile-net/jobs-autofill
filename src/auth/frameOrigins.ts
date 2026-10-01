const UNRELATED_HOST_SUFFIXES = [
  'recaptcha.net',
  'hcaptcha.com',
  'challenges.cloudflare.com',
  'app.qualified.com',
  'linkedin.com',
  'indeed.com',
  'facebook.com',
  'platform.twitter.com',
  'doubleclick.net',
  'googletagmanager.com',
]

const UNRELATED_PATH_PREFIXES: Array<[host: string, path: string]> = [
  ['www.google.com', '/recaptcha/'],
]

const hostMatches = (host: string, suffix: string): boolean =>
  host === suffix || host.endsWith(`.${suffix}`)

export const isUnrelatedFrameUrl = (url: string): boolean => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  const host = parsed.hostname.toLowerCase()
  if (host.split('.').some((label) => label.includes('captcha'))) return true
  if (UNRELATED_HOST_SUFFIXES.some((suffix) => hostMatches(host, suffix))) return true
  return UNRELATED_PATH_PREFIXES.some(
    ([prefixHost, path]) => host === prefixHost && parsed.pathname.startsWith(path),
  )
}

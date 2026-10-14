import isPostalCode, { locales } from 'validator/es/lib/isPostalCode'

import type { Profile } from '~/api/types'
import { parseLocation } from './parseLocation'

type PostalLocale = (typeof locales)[number]

const SUPPORTED = new Set<string>(locales)

const isSupported = (code: string): code is PostalLocale => SUPPORTED.has(code)

const candidatesOf = (text: string, skipFirstWord: boolean): string[] =>
  text.split(',').flatMap((part, partIndex) => {
    const words = part.trim().split(/\s+/).filter(Boolean)
    const start = skipFirstWord && partIndex === 0 ? 1 : 0
    return words.flatMap((word, i) => (i < start ? [] : [word, ...(words[i + 1] ? [`${word} ${words[i + 1]}`] : [])]))
  })

export const postalCodeFromAddress = (profile: Profile): string | null => {
  const country = parseLocation(profile.location)?.country?.alpha2
  if (!country || !isSupported(country)) return null
  const sources: Array<[string, boolean]> = [
    [profile.addressLine1 ?? '', true],
    [profile.addressLine2 ?? '', false],
  ]
  const hits = new Set(
    sources.flatMap(([text, skipFirst]) => candidatesOf(text, skipFirst)).filter((candidate) => isPostalCode(candidate, country)),
  )
  return hits.size === 1 ? [...hits][0] : null
}

import type { Profile, ProfileLink } from '~/api/types'

const HOST_KINDS: [RegExp, ProfileLink['label']][] = [
  [/(^|\.)linkedin\.com$/i, 'linkedin'],
  [/(^|\.)github\.com$/i, 'github'],
]

const linkKind = (link: ProfileLink): ProfileLink['label'] => {
  try {
    const host = new URL(link.url).hostname
    return HOST_KINDS.find(([pattern]) => pattern.test(host))?.[1] ?? link.label
  } catch {
    return link.label
  }
}

export const findProfileLink = (links: ProfileLink[] | null, kind: ProfileLink['label']): string =>
  links?.find((link) => linkKind(link) === kind)?.url ?? ''

export const websiteLink = (links: ProfileLink[] | null): string =>
  findProfileLink(links, 'other') || findProfileLink(links, 'github')

export const profileEmail = (profile: Profile): string =>
  profile.email || profile.user?.email || ''

export const profilePhone = (profile: Profile): string =>
  profile.phoneNumber || profile.user?.phoneNumber || ''

import type { Profile, ProfileLink, ProfileNote } from '~/api/types'
import type { PickerMode } from '~/field/types'

export type MenuLeaf = {
  kind: 'leaf'
  id: string
  label: string
  value: string
  preview: string
  noteId?: string
}

export type MenuGroup = {
  kind: 'group'
  id: string
  label: string
  children: MenuNode[]
  emptyHint?: string
  allowAdd?: 'note'
}

export type MenuNode = MenuGroup | MenuLeaf

const trim = (s: string | null | undefined): string => (s ?? '').trim()

const splitName = (
  full: string | null,
): { first: string; last: string; middle: string } => {
  const parts = trim(full).split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first: '', last: '', middle: '' }
  if (parts.length === 1) return { first: parts[0], last: '', middle: '' }
  return {
    first: parts[0],
    last: parts[parts.length - 1],
    middle: parts.slice(1, -1).join(' '),
  }
}

const findLink = (links: ProfileLink[] | null, label: ProfileLink['label']): string =>
  links?.find((l) => l.label === label)?.url ?? ''

export const previewOf = (s: string): string => {
  const single = s.replace(/\s+/g, ' ').trim()
  return single.length > 60 ? `${single.slice(0, 57)}…` : single
}

const leafOrNull = (id: string, label: string, value: string): MenuLeaf | null => {
  if (!value) return null
  return { id, kind: 'leaf', label, preview: previewOf(value), value }
}

const filterLeaves = (...items: (MenuLeaf | null)[]): MenuLeaf[] =>
  items.filter((x): x is MenuLeaf => x !== null)

export const noteToLeaf = (n: ProfileNote): MenuLeaf => ({
  id: `nt.${n.id}`,
  kind: 'leaf',
  label: previewOf(n.content),
  noteId: n.id,
  preview: previewOf(n.content),
  value: n.content,
})

const buildNotesGroup = (profile: Profile): MenuGroup => {
  const sortedNotes = [...(profile.talentNotes ?? [])].sort((a, b) => {
    const aTime = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0
    const bTime = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0
    return bTime - aTime
  })

  const noteLeaves: MenuLeaf[] = sortedNotes
    .filter((n): n is ProfileNote => !!n.content?.trim())
    .map((n) => noteToLeaf(n))

  return {
    allowAdd: 'note',
    children: noteLeaves,
    emptyHint: 'No notes yet. Add one to get started.',
    id: 'notes',
    kind: 'group',
    label: 'Notes',
  }
}

export const buildMenuTree = (
  profile: Profile,
  mode: PickerMode = 'full',
): MenuGroup => {
  if (mode === 'notesOnly') {
    return buildNotesGroup(profile)
  }

  const name = splitName(profile.profileName)

  const identity = filterLeaves(
    leafOrNull('id.first', 'First name', name.first),
    leafOrNull('id.middle', 'Middle name', name.middle),
    leafOrNull('id.last', 'Last name', name.last),
    leafOrNull('id.full', 'Full name', trim(profile.profileName)),
    leafOrNull('id.email', 'Email', trim(profile.user?.email)),
    leafOrNull('id.phone', 'Phone', trim(profile.user?.phoneNumber)),
  )

  const links = filterLeaves(
    leafOrNull('lk.li', 'LinkedIn URL', findLink(profile.links, 'linkedin')),
    leafOrNull('lk.gh', 'GitHub URL', findLink(profile.links, 'github')),
    leafOrNull('lk.web', 'Personal website', findLink(profile.links, 'other')),
  )

  const work = filterLeaves(
    leafOrNull('wk.title', 'Current title', trim(profile.jobTitle)),
    leafOrNull('wk.exp', 'Years of experience', trim(profile.totalExperience)),
  )

  const location = filterLeaves(
    leafOrNull('loc.full', 'Location', trim(profile.location)),
  )

  const rates = filterLeaves(
    leafOrNull('rt.hr', 'Hourly rate', trim(profile.hourlyRate)),
    leafOrNull('rt.mo', 'Monthly rate', trim(profile.monthlyRate)),
    leafOrNull('rt.cur', 'Currency', trim(profile.rateCurrency)),
  )

  const summaryLeaf = leafOrNull('sum.txt', 'Summary', trim(profile.description))

  const children: MenuNode[] = []

  const addGroup = (id: string, label: string, leaves: MenuLeaf[]) => {
    if (leaves.length === 0) return
    if (leaves.length === 1) {
      children.push(leaves[0])
      return
    }
    children.push({ children: leaves, id, kind: 'group', label })
  }

  addGroup('identity', 'Identity', identity)
  addGroup('links', 'Links', links)
  addGroup('work', 'Work', work)
  addGroup('location', 'Location', location)
  addGroup('rates', 'Rates', rates)
  if (summaryLeaf) children.push(summaryLeaf)

  children.push(buildNotesGroup(profile))

  return { children, id: 'root', kind: 'group', label: 'Root' }
}
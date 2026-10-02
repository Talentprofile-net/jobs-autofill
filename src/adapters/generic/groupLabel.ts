import { blockText, containsField, isRenderedElement, precedingSiblingText, resolveLabel } from './labelResolver'
import { resolveLabelledByText } from '~/core/labelledBy'

export const groupLabel = (anchor: HTMLElement): string => {
  const fieldset = anchor.closest('fieldset') as HTMLElement | null
  if (fieldset) {
    const legend = fieldset.querySelector(':scope > legend') as HTMLElement | null
    const text = legend ? blockText(legend) : ''
    if (text) return text
  }
  const roleGroup = anchor.closest('[role="group"]') as HTMLElement | null
  if (roleGroup) {
    const ariaLabel = roleGroup.getAttribute('aria-label')?.trim()
    if (ariaLabel) return ariaLabel
    const labelledByText = resolveLabelledByText(
      roleGroup.getAttribute('aria-labelledby'),
    )
    if (labelledByText) return labelledByText
  }
  return ''
}

export const groupLabelWithContainerFallback = (anchor: HTMLElement): string => {
  const direct = groupLabel(anchor)
  if (direct) return direct
  const container = anchor.parentElement
  if (container) {
    const containerLabel = resolveLabel(container)
    if (containerLabel) return containerLabel
  }
  return resolveLabel(anchor)
}
const commonAncestor = (members: HTMLElement[]): HTMLElement | null => {
  let node = members[0]?.parentElement ?? null
  while (node && !members.every((m) => node!.contains(m))) node = node.parentElement
  return node
}

const LEADING_MAX_CHARS = 300

const leadingText = (container: HTMLElement, members: HTMLElement[]): string => {
  for (const child of Array.from(container.children)) {
    if (members.some((m) => child.contains(m))) return ''
    if (containsField(child) || !isRenderedElement(child)) continue
    const text = blockText(child)
    if (text && text.length <= LEADING_MAX_CHARS) return text
  }
  return ''
}

export const groupHeading = (members: HTMLElement[]): string => {
  const direct = members[0] ? groupLabel(members[0]) : ''
  if (direct) return direct
  const container = commonAncestor(members)
  if (!container) return ''
  return leadingText(container, members) || precedingSiblingText(container)
}

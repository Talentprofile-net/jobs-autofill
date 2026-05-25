import { resolveLabel } from './labelResolver'

export const groupLabel = (anchor: HTMLElement): string => {
  const fieldset = anchor.closest('fieldset') as HTMLElement | null
  if (fieldset) {
    const legend = fieldset.querySelector(':scope > legend') as HTMLElement | null
    const text = legend?.innerText?.trim()
    if (text) return text
  }
  const roleGroup = anchor.closest('[role="group"]') as HTMLElement | null
  if (roleGroup) {
    const ariaLabel = roleGroup.getAttribute('aria-label')?.trim()
    if (ariaLabel) return ariaLabel
    const labelledBy = roleGroup.getAttribute('aria-labelledby')
    if (labelledBy) {
      const el = document.getElementById(labelledBy)
      const text = el?.innerText?.trim()
      if (text) return text
    }
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
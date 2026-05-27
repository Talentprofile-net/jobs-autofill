import { resolveLabelledByText } from '~/core/labelledBy'

const trimText = (s: string | null | undefined): string => (s ?? '').trim()

const labelByFor = (input: HTMLElement): string => {
  const id = input.getAttribute('id')
  if (!id) return ''
  const label = document.querySelector(`label[for="${CSS.escape(id)}"]`) as HTMLElement | null
  return trimText(label?.innerText)
}

const wrappingLabel = (input: HTMLElement): string => {
  const label = input.closest('label') as HTMLElement | null
  if (!label) return ''
  const clone = label.cloneNode(true) as HTMLElement
  clone.querySelectorAll('input, select, textarea, button').forEach((el) => el.remove())
  return trimText(clone.innerText)
}

const labelByAriaLabelledby = (input: HTMLElement): string =>
  resolveLabelledByText(input.getAttribute('aria-labelledby'))

const ariaLabel = (input: HTMLElement): string => trimText(input.getAttribute('aria-label'))

const closestLegend = (input: HTMLElement): string => {
  const fieldset = input.closest('fieldset') as HTMLElement | null
  if (!fieldset) return ''
  const legend = fieldset.querySelector(':scope > legend') as HTMLElement | null
  return trimText(legend?.innerText)
}

const precedingSiblingText = (input: HTMLElement): string => {
  let node: Element | null = input.previousElementSibling
  while (node) {
    const text = trimText((node as HTMLElement).innerText)
    if (text && text.length < 200) return text
    node = node.previousElementSibling
  }
  const parent = input.parentElement
  if (parent && parent !== document.body) {
    const wrapperPrev = parent.previousElementSibling
    if (wrapperPrev) {
      const text = trimText((wrapperPrev as HTMLElement).innerText)
      if (text && text.length < 200) return text
    }
  }
  return ''
}

const placeholderOrName = (input: HTMLElement): string => {
  const placeholder = trimText(input.getAttribute('placeholder'))
  if (placeholder) return placeholder
  const name = trimText(input.getAttribute('name'))
  if (name) return name.replace(/[_\-.]+/g, ' ')
  return ''
}

export const resolveFieldLabel = (input: HTMLElement): string => {
  return (
    labelByFor(input) ||
    wrappingLabel(input) ||
    labelByAriaLabelledby(input) ||
    ariaLabel(input) ||
    closestLegend(input) ||
    precedingSiblingText(input) ||
    placeholderOrName(input)
  )
}

export const resolveGroupLabel = (group: HTMLElement): string => {
  const fieldset = group.closest('fieldset') as HTMLElement | null
  if (fieldset) {
    const legend = fieldset.querySelector(':scope > legend') as HTMLElement | null
    const text = trimText(legend?.innerText)
    if (text) return text
  }
  const roleGroup = group.closest('[role="group"]') as HTMLElement | null
  if (roleGroup) {
    const aria = trimText(roleGroup.getAttribute('aria-label'))
    if (aria) return aria
    const labelled = resolveLabelledByText(
      roleGroup.getAttribute('aria-labelledby'),
    )
    if (labelled) return labelled
  }
  return (
    labelByAriaLabelledby(group) ||
    ariaLabel(group) ||
    precedingSiblingText(group)
  )
}

export const resolveOptionLabel = (option: HTMLElement): string => {
  return (
    labelByFor(option) ||
    wrappingLabel(option) ||
    labelByAriaLabelledby(option) ||
    ariaLabel(option) ||
    placeholderOrName(option)
  )
}

export const resolveLabel = resolveFieldLabel
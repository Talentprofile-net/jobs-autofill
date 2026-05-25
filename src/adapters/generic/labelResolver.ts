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

const labelByAriaLabelledby = (input: HTMLElement): string => {
  const ids = input.getAttribute('aria-labelledby')
  if (!ids) return ''
  const parts: string[] = []
  for (const id of ids.split(/\s+/)) {
    const el = document.getElementById(id)
    const text = trimText(el?.innerText)
    if (text) parts.push(text)
  }
  return parts.join(' ')
}

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

export const resolveLabel = (input: HTMLElement): string => {
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
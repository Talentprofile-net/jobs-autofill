import { resolveLabelledByText } from '~/core/labelledBy'
import { rootQueryScope } from '~/core/shadowDom'

const trimText = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()

const VOLATILE_SELECTOR = [
  '[role="status"]',
  '[role="alert"]',
  '[role="log"]',
  '[role="progressbar"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="menu"]',
  '[role="tooltip"]',
  '[aria-live]:not([aria-live="off"])',
  '[data-tp-form-widget]',
  '[data-tp-field-widget]',
  'script',
  'style',
  'template',
].join(', ')

const CONTROL_SELECTOR = 'input, select, textarea, button, [role="button"], [role="combobox"], [role="textbox"]'

const FIELD_SELECTOR = 'input:not([type="hidden"]), select, textarea, [role="combobox"], [role="textbox"], [contenteditable="true"], [contenteditable=""]'

const FILE_ACTION_SELECTOR = 'a, [role="link"]'

const FILE_NAME = /[^\s/\\]+\.(pdf|docx?|rtf|txt|odt|pages)\b/gi

const BLOCK_TAGS = new Set(['ADDRESS', 'ARTICLE', 'BR', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LEGEND', 'LI', 'OL', 'P', 'SECTION', 'TABLE', 'TD', 'TH', 'TR', 'UL'])

const PRECEDING_MAX_CHARS = 300
const PRECEDING_MAX_DEPTH = 4

type Skip = (el: Element) => boolean

const isRendered = (el: Element): boolean => {
  const probe = el as Element & { checkVisibility?: (options?: object) => boolean }
  if (typeof probe.checkVisibility === 'function') {
    return probe.checkVisibility({ visibilityProperty: true })
  }
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (node.hasAttribute('hidden')) return false
    if (/display\s*:\s*none/i.test(node.getAttribute('style') ?? '')) return false
  }
  return true
}

const collectText = (node: Node, skip: Skip, out: string[]): void => {
  if (node.nodeType === 3) {
    out.push(node.textContent ?? '')
    return
  }
  if (node.nodeType !== 1) return
  const el = node as Element
  if (skip(el) || !isRendered(el)) return
  const block = BLOCK_TAGS.has(el.tagName)
  if (block) out.push(' ')
  for (const child of Array.from(el.childNodes)) collectText(child, skip, out)
  if (block) out.push(' ')
}

const textOf = (nodes: Node[], skip: Skip): string => {
  const out: string[] = []
  for (const node of nodes) collectText(node, skip, out)
  return trimText(out.join(''))
}

const isFileInput = (el: HTMLElement): boolean =>
  el.tagName === 'INPUT' && (el.getAttribute('type') ?? '').toLowerCase() === 'file'

const REQUIRED_NOISE = /^\(?\s*\*?\s*required\s*\*?\s*\)?\.?$/i
const SCREEN_READER_HINT = /(^|[\s_-])(sr-only|visually-hidden|visuallyhidden|screen-reader-only|screen-reader-text|a11y-hidden|assistive-text)($|[\s_-])/i

const isScreenReaderOnly = (el: Element): boolean => {
  if (SCREEN_READER_HINT.test(el.getAttribute('class') ?? '')) return true
  const view = el.ownerDocument.defaultView
  if (!view || typeof view.getComputedStyle !== 'function') return false
  const style = view.getComputedStyle(el)
  if (style.position !== 'absolute' && style.position !== 'fixed') return false
  const rect = el.getBoundingClientRect()
  const clipped = /rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)|rect\(1px,? 1px,? 1px,? 1px\)/.test(style.clip ?? '') || /inset\(50%\)/.test(style.clipPath ?? '')
  return clipped || (rect.width <= 1 && rect.height <= 1)
}

const isRequiredNoise = (el: Element): boolean =>
  REQUIRED_NOISE.test((el.textContent ?? '').trim()) && isScreenReaderOnly(el)

const skipFor = (control: HTMLElement): Skip => {
  const file = isFileInput(control)
  return (el) =>
    isRequiredNoise(el) ||
    el.matches(VOLATILE_SELECTOR) ||
    el.matches(CONTROL_SELECTOR) ||
    (file && el.matches(FILE_ACTION_SELECTOR))
}

const withoutFileNames = (control: HTMLElement, text: string): string =>
  isFileInput(control) ? trimText(text.replace(FILE_NAME, ' ')) : text

const labelElementText = (label: HTMLElement, control: HTMLElement): string => {
  const skip = skipFor(control)
  if (label.contains(control)) {
    const outside = Array.from(label.childNodes).filter((n) => !(n.nodeType === 1 && (n as Element).contains(control)))
    const branchText = textOf(outside, skip)
    if (branchText) return withoutFileNames(control, branchText)
  }
  return withoutFileNames(control, textOf([label], skip))
}

const labelByFor = (input: HTMLElement): string => {
  const id = input.getAttribute('id')
  if (!id) return ''
  const label = rootQueryScope(input).querySelector<HTMLElement>(`label[for="${CSS.escape(id)}"]`)
  return label ? labelElementText(label, input) : ''
}

const wrappingLabel = (input: HTMLElement): string => {
  const label = input.closest('label') as HTMLElement | null
  return label ? labelElementText(label, input) : ''
}

const labelByAriaLabelledby = (input: HTMLElement): string =>
  resolveLabelledByText(input.getAttribute('aria-labelledby'), input)

const ariaLabel = (input: HTMLElement): string => trimText(input.getAttribute('aria-label'))

const closestLegend = (input: HTMLElement): string => {
  const fieldset = input.closest('fieldset') as HTMLElement | null
  if (!fieldset) return ''
  const legend = fieldset.querySelector(':scope > legend') as HTMLElement | null
  return legend ? textOf([legend], skipFor(input)) : ''
}

const isActionOnly = (el: Element): boolean => el.matches('button, a, [role="button"], [role="link"]')

export const blockText = (el: Element): string =>
  textOf([el], (n) => isRequiredNoise(n) || n.matches(VOLATILE_SELECTOR) || n.matches(CONTROL_SELECTOR))

export const containsField = (el: Element): boolean => el.matches(FIELD_SELECTOR) || el.querySelector(FIELD_SELECTOR) !== null

export const isRenderedElement = (el: Element): boolean => isRendered(el)

export const precedingSiblingText = (start: HTMLElement): string => {
  const skip = skipFor(start)
  let node: HTMLElement | null = start
  for (let depth = 0; node && depth < PRECEDING_MAX_DEPTH; depth++) {
    if (node.tagName === 'FORM' || node === document.body) return ''
    for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (sib.matches(FIELD_SELECTOR) || sib.querySelector(FIELD_SELECTOR)) return ''
      if (isActionOnly(sib) || !isRendered(sib)) continue
      const text = textOf([sib], skip)
      if (text && text.length <= PRECEDING_MAX_CHARS) return text
    }
    node = node.parentElement
  }
  return ''
}

const shadowHostLabel = (input: HTMLElement): string => {
  const root = input.getRootNode()
  if (!(root instanceof ShadowRoot)) return ''
  return trimText(root.host.getAttribute('aria-label')) || trimText(root.host.getAttribute('label'))
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
    shadowHostLabel(input) ||
    closestLegend(input) ||
    precedingSiblingText(input) ||
    placeholderOrName(input)
  )
}

export const resolveGroupLabel = (group: HTMLElement): string => {
  const fieldset = group.closest('fieldset') as HTMLElement | null
  if (fieldset) {
    const legend = fieldset.querySelector(':scope > legend') as HTMLElement | null
    const text = legend ? blockText(legend) : ''
    if (text) return text
  }
  const roleGroup = group.closest('[role="group"]') as HTMLElement | null
  if (roleGroup) {
    const aria = trimText(roleGroup.getAttribute('aria-label'))
    if (aria) return aria
    const labelled = resolveLabelledByText(
      roleGroup.getAttribute('aria-labelledby'),
      roleGroup,
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

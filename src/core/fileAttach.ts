import { acceptsPdf, fromBase64, type CvFileValue } from '~/resolver/cvFile'
import { hasConcealingAncestor, isOffCanvas } from './concealment'
import { composedParent } from './shadowDom'

const DISPLAY_ANCESTOR_DEPTH = 4

const isShown = (el: Element): boolean => {
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  const style = el.ownerDocument.defaultView?.getComputedStyle(el)
  return style?.visibility !== 'hidden' && style?.display !== 'none'
}

export const hasDisplayedAncestor = (input: Element): boolean => {
  if (hasConcealingAncestor(input, false)) return false
  let node: Node | null = input
  for (let depth = 0; node && depth <= DISPLAY_ANCESTOR_DEPTH; depth++) {
    if (node instanceof Element && isShown(node)) return !isOffCanvas(node)
    node = composedParent(node)
  }
  return false
}

export const attachedFileNames = (input: HTMLInputElement): string =>
  Array.from(input.files ?? [])
    .map((file) => file.name)
    .join(', ')

export const attachFile = (input: HTMLInputElement, value: CvFileValue): boolean => {
  if (input.disabled || !hasDisplayedAncestor(input)) return false
  if (!acceptsPdf(input.getAttribute('accept'))) return false
  const file = new File([fromBase64(value.base64)], value.name, { type: value.mimeType })
  const transfer = new DataTransfer()
  transfer.items.add(file)
  input.files = transfer.files
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
  input.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
  return input.files?.length === 1 && input.files[0].name === value.name
}

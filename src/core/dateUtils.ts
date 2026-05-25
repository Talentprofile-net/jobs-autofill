export const PART_MARKER_ATTR = 'data-tp-field-part'

export const widthFor = (input: HTMLInputElement, fallback: number): number => {
  const maxLength = input.maxLength
  if (typeof maxLength === 'number' && maxLength > 0) return maxLength
  const placeholder = input.getAttribute('placeholder') ?? ''
  if (placeholder.length > 0) return placeholder.length
  return fallback
}
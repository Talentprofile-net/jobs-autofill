export const padToWidth = (value: string, width: number): string => {
  if (!value) return value
  if (width <= 0) return value
  if (value.length === width) return value
  if (value.length > width) return value.slice(value.length - width)
  return value.padStart(width, '0')
}
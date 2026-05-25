export type ParsedDate = {
  year: string
  month: string | null
  day: string | null
}

export const parseDate = (input: string | null | undefined): ParsedDate | null => {
  if (!input) return null
  const trimmed = input.trim()
  if (trimmed.length === 0) return null

  const isoFull = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed)
  if (isoFull) {
    return { year: isoFull[1], month: isoFull[2], day: isoFull[3] }
  }

  const yearMonth = /^(\d{4})-(\d{2})$/.exec(trimmed)
  if (yearMonth) {
    return { year: yearMonth[1], month: yearMonth[2], day: null }
  }

  const yearOnly = /^(\d{4})$/.exec(trimmed)
  if (yearOnly) {
    return { year: yearOnly[1], month: null, day: null }
  }

  return null
}
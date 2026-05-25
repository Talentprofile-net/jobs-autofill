export type ParsedSection = {
  type: 'education' | 'employment' | 'other'
  index: number | null
  raw: string
}

const SECTION_REGEX = /^(education|employment)\s+(\d+)$/i

export const parseSection = (section: string): ParsedSection => {
  const trimmed = (section ?? '').trim()
  if (!trimmed) {
    return { type: 'other', index: null, raw: '' }
  }
  const match = SECTION_REGEX.exec(trimmed)
  if (match) {
    const type = match[1].toLowerCase() as 'education' | 'employment'
    const index = parseInt(match[2], 10) - 1
    return { type, index: Number.isFinite(index) && index >= 0 ? index : null, raw: trimmed }
  }
  return { type: 'other', index: null, raw: trimmed }
}
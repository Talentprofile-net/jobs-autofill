const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const PLACEHOLDER_PATTERN = /^\s*(dd|mm|yyyy|yy)([./\- ])(dd|mm|yyyy|yy)\2(dd|mm|yyyy|yy)\s*$/i

export type DateParts = { year: string; month?: string; day?: string }

const textInputOf = (element: HTMLElement): HTMLInputElement | null =>
  element instanceof HTMLInputElement ? element : element.querySelector<HTMLInputElement>('input:not([type="hidden"])')

const fromPlaceholder = (placeholder: string, year: string, month: string, day: string): string | null => {
  const hint = PLACEHOLDER_PATTERN.exec(placeholder)
  if (!hint) return null
  const tokens = [hint[1], hint[3], hint[4]].map((token) => token.toLowerCase())
  if (new Set(tokens.map((token) => token[0])).size !== 3) return null
  return tokens.map((token) => (token === 'dd' ? day : token === 'mm' ? month : token === 'yyyy' ? year : year.slice(2))).join(hint[2])
}

export const dateTextFor = (element: HTMLElement, date: DateParts): string | null => {
  if (!date.month || !date.day || !/^\d{4}$/.test(date.year)) return null
  const month = date.month.padStart(2, '0')
  const day = date.day.padStart(2, '0')
  const input = textInputOf(element)
  if (input?.type === 'date') return `${date.year}-${month}-${day}`
  const hinted = input ? fromPlaceholder(input.placeholder ?? '', date.year, month, day) : null
  if (hinted) return hinted
  if (input?.closest('.react-datepicker__input-container')) return `${month}/${day}/${date.year}`
  const name = MONTHS[Number(month) - 1]
  return name ? `${name} ${Number(day)}, ${date.year}` : null
}

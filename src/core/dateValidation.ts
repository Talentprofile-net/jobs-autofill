const isDigits = (value: string): boolean => /^\d+$/.test(value)

export const isValidMonth = (m: string): boolean => {
  if (!isDigits(m)) return false
  const n = Number(m)
  return n >= 1 && n <= 12
}

export const isValidDay = (d: string): boolean => {
  if (!isDigits(d)) return false
  const n = Number(d)
  return n >= 1 && n <= 31
}

export const isValidYear = (y: string): boolean => {
  if (!isDigits(y)) return false
  const n = Number(y)
  return n >= 1900 && n <= 2100
}
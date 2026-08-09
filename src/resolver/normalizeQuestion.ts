import slugify from '@sindresorhus/slugify'

export const normalizeQuestion = (text: string): string =>
  slugify(text, {
    decamelize: false,
    lowercase: true,
    separator: '-',
  })
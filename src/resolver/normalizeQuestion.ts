import slugify from '@sindresorhus/slugify'

// TODO: likely we need to also save original, because otherwise how we're going to train model if we train it on slugs?
export const normalizeQuestion = (text: string): string =>
  slugify(text, {
    decamelize: false,
    lowercase: true,
    separator: '-',
  })
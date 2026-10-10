const PRONUNCIATION = /\b(pronounc\w*|pronunciation\w*|phonetic\w*)\b/i

const NAME = /\bnames?\b/i

const SAY = /\bhow\b[^.?!]*\bsay\b/i

export const isNamePronunciationQuestion = (text: string): boolean => {
  const flat = text.replace(/[\s_-]+/g, ' ')
  return PRONUNCIATION.test(flat) || (NAME.test(flat) && SAY.test(flat))
}

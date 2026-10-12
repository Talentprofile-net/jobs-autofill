const PRONUNCIATION = /\b(pronounc\w*|pronunciation\w*|phonetic\w*)\b/i

const NAME = /\bnames?\b/i

const SAY = /\b(say|said|spoken|sounds?)\b/i

const SCRIPT =
  /\b(katakana|hiragana|kanji|furigana|romaji|hangul|devanagari|cyrillic|pinyin|romani[sz](ed|ation)|transliterat\w*|(native|local|original|non-latin|chinese|japanese|korean|arabic|thai) (script|characters?|alphabet)|thai|chinese|japanese|korean|arabic|hebrew|greek|russian|ukrainian|hindi)\b/i

export const isNamePronunciationQuestion = (text: string): boolean => {
  const flat = text.replace(/[\s_-]+/g, ' ')
  return PRONUNCIATION.test(flat) || (NAME.test(flat) && (SAY.test(flat) || SCRIPT.test(flat)))
}

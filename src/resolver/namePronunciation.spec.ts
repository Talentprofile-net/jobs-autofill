import { describe, expect, it } from 'bun:test'

import { isNamePronunciationQuestion } from './namePronunciation'

describe('name pronunciation question', () => {
  it.each([
    'How do you pronounce your name?',
    'Name pronunciation',
    'Phonetic spelling of your name',
    'How should we say your name?',
    'How do you pronounce your first name?',
    'Pronunciation of your name (optional)',
    'name_pronunciation',
    'Phonetic name',
  ])('recognizes %p', (text) => {
    expect(isNamePronunciationQuestion(text)).toBe(true)
  })

  it.each([
    'Preferred pronouns',
    'Pronouns',
    'What are your pronouns?',
    'Full name',
    'Legal name',
    'Your name',
    'Name',
    'What would you like to say to the hiring team?',
    'Is there anything else you want to say?',
  ])('does not recognize %p', (text) => {
    expect(isNamePronunciationQuestion(text)).toBe(false)
  })
})

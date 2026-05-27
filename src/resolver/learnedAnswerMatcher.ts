import type { TalentAnswer } from '~/api/types'
import type { ProfileValue } from '~/field/types'
import { normalizeQuestion } from './normalizeQuestion'

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'must', 'ought',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her',
  'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their',
  'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom',
  'how', 'when', 'where', 'why', 'if', 'or', 'and', 'but', 'not',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after',
  'currently', 'please', 'select', 'enter', 'provide',
])

const extractKeywords = (normalized: string): Set<string> => {
  const out = new Set<string>()
  for (const w of normalized.split(/\s+/)) {
    if (w.length > 1 && !STOPWORDS.has(w)) out.add(w)
  }
  return out
}

const jaccard = (a: Set<string>, b: Set<string>): { score: number; shared: number } => {
  if (a.size === 0 && b.size === 0) return { score: 0, shared: 0 }
  let intersection = 0
  for (const w of a) if (b.has(w)) intersection++
  const union = a.size + b.size - intersection
  return { score: union === 0 ? 0 : intersection / union, shared: intersection }
}

export type MatchMethod = 'exact_hash' | 'normalized_text' | 'jaccard'

export type MatchResult = {
  answer: TalentAnswer
  score: number
  method: MatchMethod
}

const JACCARD_MIN_SCORE = 0.7
const JACCARD_MIN_SHARED = 3

const typesCompatible = (a: string, b: string): boolean => {
  if (a === b) return true
  if (a === 'ContentEditable' && b === 'TextInput') return true
  if (a === 'TextInput' && b === 'ContentEditable') return true
  return false
}

export const findLearnedAnswer = (
  questionText: string,
  fieldType: string,
  answers: TalentAnswer[],
): MatchResult | null => {
  if (answers.length === 0) return null

  const normalized = normalizeQuestion(questionText)

  for (const answer of answers) {
    if (!typesCompatible(answer.fieldType, fieldType)) continue
    if (answer.normalizedQuestion === normalized) {
      return { answer, score: 1.0, method: 'normalized_text' }
    }
  }

  const keywords = extractKeywords(normalized)
  if (keywords.size < JACCARD_MIN_SHARED) return null

  let best: MatchResult | null = null
  for (const answer of answers) {
    if (!typesCompatible(answer.fieldType, fieldType)) continue
    const otherKeywords = extractKeywords(answer.normalizedQuestion)
    const { score, shared } = jaccard(keywords, otherKeywords)
    if (score < JACCARD_MIN_SCORE) continue
    if (shared < JACCARD_MIN_SHARED) continue
    if (!best || score > best.score) {
      best = { answer, score, method: 'jaccard' }
    }
  }

  return best
}

const isPlaceholderText = (s: string): boolean => {
  const n = s.trim().toLowerCase()
  return n === '' || n === '--' || n === '---'
}

export const learnedAnswerToProfileValue = (
  match: MatchResult,
  fieldType: string,
): ProfileValue => {
  const stored = match.answer.answerValue as ProfileValue | undefined
  if (stored && stored.kind) {
    if (match.method === 'jaccard' && stored.kind === 'string') {
      return { ...stored, confidence: 'guess' }
    }
    return stored
  }

  const text = match.answer.answerText ?? ''
  if (isPlaceholderText(text)) return { kind: 'unsupported' }

  if (fieldType === 'SingleCheckbox') {
    const lower = text.toLowerCase().trim()
    return { kind: 'boolean', value: lower === 'yes' || lower === 'true' }
  }

  if (fieldType === 'SimpleDropdown' || fieldType === 'RadioGroup' || fieldType === 'BooleanRadio') {
    return { kind: 'choice', preferred: text, fallbacks: [] }
  }

  if (fieldType === 'MultiCheckbox' || fieldType === 'MultiSelect' || fieldType === 'MultiSearchableDropdown') {
    return { kind: 'multiChoice', preferred: [text], fallbacks: [] }
  }

  const confidence: 'exact' | 'guess' = match.method === 'jaccard' ? 'guess' : 'exact'
  return { kind: 'string', value: text, confidence }
}
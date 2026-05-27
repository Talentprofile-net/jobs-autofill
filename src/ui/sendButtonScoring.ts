const SEND_ARIA_PATTERNS = [
  /\bsend\b/i,
  /\bsubmit\b/i,
  /\bapply\b/i,
  /\bcontinue\b/i,
  /\bnext\b/i,
  /\bотправить\b/i,
]

const SEND_ID_PATTERNS = [
  /(^|[-_])send($|[-_])/i,
  /(^|[-_])submit($|[-_])/i,
]

const SEND_TEXT_VALUES = new Set([
  'send',
  'submit',
  'apply',
  'continue',
  'next',
])

export const scoreSendButton = (btn: HTMLElement): number => {
  let score = 0
  if (btn.getAttribute('type') === 'submit') score += 10

  const aria = btn.getAttribute('aria-label') ?? ''
  if (aria) {
    for (const re of SEND_ARIA_PATTERNS) {
      if (re.test(aria)) {
        score += 8
        break
      }
    }
  }

  const testId =
    btn.getAttribute('data-testid') ?? btn.getAttribute('data-test') ?? ''
  if (testId) {
    for (const re of SEND_ID_PATTERNS) {
      if (re.test(testId)) {
        score += 6
        break
      }
    }
  }

  const id = btn.id ?? ''
  if (id) {
    for (const re of SEND_ID_PATTERNS) {
      if (re.test(id)) {
        score += 4
        break
      }
    }
  }

  const text = (btn.textContent ?? '').trim().toLowerCase()
  if (text.length > 0 && text.length <= 20 && SEND_TEXT_VALUES.has(text)) {
    score += 5
  }

  return score
}
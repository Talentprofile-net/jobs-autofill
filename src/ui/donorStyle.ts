const MAX_DONOR_DIM_PX = 60

const SEND_ARIA_PATTERNS = [
  /\bsend\b/i,
  /\bsubmit\b/i,
  /\bvoice\b/i,
  /\brecord\b/i,
  /\bстарт\b/i,
  /\bотправить\b/i,
]

const buttonLooksLikeSend = (btn: HTMLElement): number => {
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
  const dataTestId = btn.getAttribute('data-testid') ?? ''
  if (/send|submit/i.test(dataTestId)) score += 6
  const id = btn.id ?? ''
  if (/send|submit/i.test(id)) score += 4
  if (btn.querySelector('svg') && !btn.textContent?.trim()) score += 1
  return score
}

export type DonorAppearance = {
  background: string | null
  color: string | null
  borderRadius: string | null
  padding: string | null
  surfaceBackground: string | null
  surfaceBorder: string | null
}

export const findIconDonor = (
  scope: HTMLElement,
  exclude: HTMLElement | null,
): HTMLElement | null => {
  const candidates = Array.from(
    scope.querySelectorAll<HTMLElement>('button, [role="button"]'),
  )
  let best: HTMLElement | null = null
  let bestScore = -Infinity
  for (const btn of candidates) {
    if (exclude && (btn === exclude || exclude.contains(btn) || btn.contains(exclude))) continue
    if (btn.getAttribute('data-tp-field-widget') === 'true') continue
    if (btn.getAttribute('data-tp-picker') === 'true') continue
    if (btn.closest('[data-tp-field-widget="true"]')) continue
    if (btn.closest('[data-tp-picker="true"]')) continue
    if (btn.hasAttribute('hidden')) continue
    if (btn.getAttribute('aria-hidden') === 'true') continue
    const rect = btn.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    if (rect.width > MAX_DONOR_DIM_PX || rect.height > MAX_DONOR_DIM_PX) continue
    const hasSvg = !!btn.querySelector('svg')
    const text = (btn.textContent ?? '').trim()
    const sendScore = buttonLooksLikeSend(btn)
    let score = 0
    if (hasSvg) score += 5
    if (Math.abs(rect.width - rect.height) < 8) score += 3
    if (text.length === 0) score += 3
    if (text.length > 12) score -= 4
    score -= sendScore
    if (score > bestScore) {
      bestScore = score
      best = btn
    }
  }
  return best
}

const isMeaningfulBackground = (bg: string): boolean => {
  if (!bg) return false
  if (bg === 'rgba(0, 0, 0, 0)') return false
  if (bg === 'transparent') return false
  return true
}

export const readDonorAppearance = (
  donor: HTMLElement | null,
  surfaceScope: HTMLElement | null,
): DonorAppearance => {
  const out: DonorAppearance = {
    background: null,
    color: null,
    borderRadius: null,
    padding: null,
    surfaceBackground: null,
    surfaceBorder: null,
  }

  if (donor) {
    const s = window.getComputedStyle(donor)
    if (isMeaningfulBackground(s.backgroundColor)) out.background = s.backgroundColor
    if (s.color) out.color = s.color
    if (s.borderRadius && s.borderRadius !== '0px') out.borderRadius = s.borderRadius
    if (s.padding && s.padding !== '0px') out.padding = s.padding
  }

  if (surfaceScope) {
    let node: HTMLElement | null = surfaceScope
    let depth = 0
    while (node && depth < 6) {
      const s = window.getComputedStyle(node)
      if (isMeaningfulBackground(s.backgroundColor)) {
        out.surfaceBackground = s.backgroundColor
        const borderColor = s.borderTopColor
        if (borderColor && borderColor !== 'rgba(0, 0, 0, 0)') {
          out.surfaceBorder = borderColor
        }
        break
      }
      node = node.parentElement
      depth++
    }
  }

  return out
}

export const applyAppearanceVars = (
  host: HTMLElement,
  appearance: DonorAppearance,
  prefix: 'tp-icon' | 'tp-picker',
): void => {
  if (prefix === 'tp-icon') {
    if (appearance.background) host.style.setProperty('--tp-icon-bg', appearance.background)
    if (appearance.color) host.style.setProperty('--tp-icon-color', appearance.color)
    if (appearance.borderRadius) host.style.setProperty('--tp-icon-radius', appearance.borderRadius)
    if (appearance.padding) host.style.setProperty('--tp-icon-padding', appearance.padding)
    return
  }
  if (appearance.surfaceBackground) {
    host.style.setProperty('--tp-picker-bg', appearance.surfaceBackground)
  }
  if (appearance.color) {
    host.style.setProperty('--tp-picker-fg', appearance.color)
  }
  if (appearance.surfaceBorder) {
    host.style.setProperty('--tp-picker-border', appearance.surfaceBorder)
  }
}
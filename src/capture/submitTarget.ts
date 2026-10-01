export const findEnclosingForm = (el: HTMLElement): HTMLElement | null => {
  const direct = el.closest('form')
  if (direct) return direct as HTMLElement
  let node: HTMLElement | null = el.parentElement
  let depth = 0
  while (node && depth < 12) {
    const role = node.getAttribute('role')
    if (role === 'form' || role === 'main') return node
    node = node.parentElement
    depth++
  }
  return null
}

export const submitButtonFor = (target: HTMLElement): HTMLElement | null => {
  const btn = target.closest<HTMLElement>('button, input[type="submit"], [role="button"]')
  if (!btn) return null
  const type = btn.getAttribute('type')
  const looksSubmit =
    type === 'submit' ||
    /\b(submit|apply|send)\b/i.test(btn.textContent ?? '') ||
    /\b(submit|apply|send)\b/i.test(btn.getAttribute('aria-label') ?? '')
  return looksSubmit ? btn : null
}

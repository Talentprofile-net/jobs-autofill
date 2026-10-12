const NON_SUBMIT_TYPES: ReadonlySet<string> = new Set(['button', 'reset'])

const implicitSubmitter = (el: Element): Element | null => {
  const button = el.closest('button')
  if (!button) return null
  return NON_SUBMIT_TYPES.has((button.getAttribute('type') ?? '').trim().toLowerCase()) ? null : button
}

export const withoutImplicitSubmit = (el: Element, act: () => void): void => {
  const button = implicitSubmitter(el)
  if (!button) {
    act()
    return
  }
  const declared = button.getAttribute('type')
  button.setAttribute('type', 'button')
  try {
    act()
  } finally {
    if (declared === null) button.removeAttribute('type')
    else button.setAttribute('type', declared)
  }
}

export const activateControl = (el: HTMLElement | null | undefined): void => {
  if (el) withoutImplicitSubmit(el, () => el.click())
}

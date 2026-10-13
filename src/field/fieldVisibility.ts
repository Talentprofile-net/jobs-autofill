type VisibilityProbe = { checkVisibility?: (options: { visibilityProperty: boolean; opacityProperty: boolean }) => boolean }

export const isVisible = (el: HTMLElement): boolean => {
  const probe: VisibilityProbe = el
  if (typeof probe.checkVisibility === 'function') {
    return probe.checkVisibility({
      opacityProperty: true,
      visibilityProperty: true,
    })
  }
  const rect = el.getBoundingClientRect()
  if (rect.height <= 0 || rect.width <= 0) return false
  const style = window.getComputedStyle(el)
  if (style.visibility === 'hidden' || style.display === 'none') return false
  if (parseFloat(style.opacity || '1') === 0) return false
  return true
}

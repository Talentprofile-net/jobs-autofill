import { FIELD_MARKER_ATTR } from '~/config'
import { closestComposed, deepActiveElement } from '~/core/shadowDom'

export const focusedFieldTarget = (
  doc: Document = document,
): { fieldUuid: string; focused: HTMLElement } | null => {
  if (!doc.hasFocus()) return null
  const focused = deepActiveElement(doc)
  if (!(focused instanceof HTMLElement)) return null
  const fieldUuid = closestComposed(focused, `[${FIELD_MARKER_ATTR}]`)?.getAttribute(FIELD_MARKER_ATTR)
  return fieldUuid ? { fieldUuid, focused } : null
}

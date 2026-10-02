import { FIELD_MARKER_ATTR } from '~/config'
import { PART_MARKER_ATTR } from '~/core/dateUtils'
import { closestComposed, deepActiveElement } from '~/core/shadowDom'

export const focusedFieldTarget = (
  doc: Document = document,
): { fieldUuid: string; focused: HTMLElement } | null => {
  if (!doc.hasFocus()) return null
  const focused = deepActiveElement(doc)
  if (!(focused instanceof HTMLElement)) return null
  const owner = closestComposed(focused, `[${FIELD_MARKER_ATTR}], [${PART_MARKER_ATTR}]`)
  const fieldUuid = owner?.getAttribute(FIELD_MARKER_ATTR) ?? owner?.getAttribute(PART_MARKER_ATTR)
  return fieldUuid ? { fieldUuid, focused } : null
}

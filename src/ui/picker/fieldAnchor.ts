import { FIELD_MARKER_ATTR } from '~/config'
import { querySelectorDeep } from '~/core/shadowDom'

export const FIELD_WIDGET_ATTR = 'data-tp-field-widget'
export const FIELD_WIDGET_UUID_ATTR = 'data-tp-field-uuid'

const INPUT_SELECTOR =
  'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="file"]):not([type="password"]),' +
  'textarea, [contenteditable="true"], [contenteditable=""], [role="textbox"]'

export const findHostAnchor = (field: HTMLElement): HTMLElement | null => {
  if (field.matches(INPUT_SELECTOR)) return field
  return field.querySelector<HTMLElement>(INPUT_SELECTOR)
}

export const fieldElementByUuid = (uuid: string): HTMLElement | null =>
  querySelectorDeep<HTMLElement>(document, `[${FIELD_MARKER_ATTR}="${CSS.escape(uuid)}"]`)

export const widgetHostByUuid = (uuid: string): HTMLElement | null =>
  querySelectorDeep<HTMLElement>(document, `[${FIELD_WIDGET_UUID_ATTR}="${CSS.escape(uuid)}"]`)

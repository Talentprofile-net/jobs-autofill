import { getElement } from '~/core/getElements'
import { BaseField } from '~/field/baseField'

/**
 * Greenhouse Classic label cleanup.
 *
 * Some Greenhouse Classic forms (older "boards.greenhouse.io" pages) inject
 * visually-hidden text into field labels for accessibility/anti-bot purposes.
 * The injected text appears in the label's innerText as the characters
 * "j", "a", "f" separated by double newlines (one character per hidden span,
 * each on its own line). innerText preserves the line breaks.
 *
 * If you no longer see this on live forms, this stripping is a no-op and can
 * be removed. Until then it is load-bearing for fieldName matching.
 */
const HIDDEN_LABEL_MARKER = 'j\n\na\n\nf'

export abstract class GreenhouseBaseInput extends BaseField {
  override get fieldName(): string {
    return super.fieldName?.replaceAll(HIDDEN_LABEL_MARKER, '') ?? ''
  }

  override get section(): string {
    const sectionEl = getElement(this.element, `ancestor::div[@jaf-section][1]`)
    return sectionEl?.getAttribute('jaf-section') ?? ''
  }
}
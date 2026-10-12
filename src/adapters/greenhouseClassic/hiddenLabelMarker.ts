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

export const withoutHiddenLabelMarker = (text: string): string => text.replaceAll(HIDDEN_LABEL_MARKER, '')

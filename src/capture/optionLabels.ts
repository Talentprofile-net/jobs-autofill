// Reads the option labels of a choice field straight off the DOM.
//
// The corpus decides `answerKind` from the OPTION SET, not from the value the
// applicant happened to pick: a dropdown offering Yes/No is `boolean` there,
// while the same widget offering three countries is `choice`. Reproducing that
// here needs the labels, and no adapter exposes them — `BaseField` has
// `currentValue()` and `fill()` and nothing else.
//
// So this reads native markup generically rather than adding a method to forty
// adapters. Native `<select>`, radio groups and checkbox groups are exactly
// where boolean-shaped option sets live, and they are also what the scrape
// worker's own extractor reads. A custom ATS widget returns null, and the
// caller falls back — see corpusVocabulary.ts for what null means per type.
const MAX_OPTIONS = 60

const escapeSelectorValue = (value: string): string =>
  typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/["\\]/g, '\\$&')

const labelTextFor = (input: HTMLInputElement): null | string => {
  const labels = input.labels
  if (labels && labels.length > 0) {
    const text = labels[0].textContent?.trim()
    if (text) return text
  }

  const aria = input.getAttribute('aria-label')?.trim()
  if (aria) return aria

  const wrapping = input.closest('label')?.textContent?.trim()
  if (wrapping) return wrapping

  const value = input.getAttribute('value')?.trim()
  return value || null
}

const fromSelect = (select: HTMLSelectElement): string[] =>
  Array.from(select.options)
    .map((option) => (option.label || option.textContent || '').trim())
    .filter((label) => label.length > 0)

// Prefer the semantic question container. ATS markup sometimes assigns one
// distinct name per option even though the controls answer one question.
const fromGroup = (input: HTMLInputElement): null | string[] => {
  const question = input.closest<HTMLElement>(
    'fieldset, [role="radiogroup"], [role="group"], [class*="question"], [class*="field-group"], [class*="form-group"], [class*="radio-group"], [class*="checkbox-group"], [data-field]',
  )
  if (question) {
    const members = Array.from(
      question.querySelectorAll<HTMLInputElement>(`input[type="${input.type}"]`),
    )
    const labels = members
      .map(labelTextFor)
      .filter((label): label is string => Boolean(label))
    if (labels.length > 0) return labels
  }

  const name = input.getAttribute('name')
  if (!name) return null

  const scope: ParentNode = input.form ?? input.ownerDocument
  const selector = `input[type="${input.type}"][name="${escapeSelectorValue(name)}"]`
  const members = Array.from(scope.querySelectorAll<HTMLInputElement>(selector))
  if (members.length === 0) return null

  const labels = members
    .map(labelTextFor)
    .filter((label): label is string => Boolean(label))

  return labels.length > 0 ? labels : null
}

// Grouped inputs nested anywhere inside a container.
//
// `field.element` is not always the input itself. A radio or checkbox group is
// most often a wrapper — a fieldset, a div with `role="radiogroup"`, an ATS's own
// component root — with the real inputs somewhere below it. Reading only the
// element itself found nothing for exactly the widgets whose option set decides
// their answerKind, so every grouped field fell back to the null branch.
//
// The field adapter already chose the question container, so all same-typed
// descendants belong to that logical question even when their names differ.
const fromContainer = (container: HTMLElement): null | string[] => {
  const inputs = Array.from(
    container.querySelectorAll<HTMLInputElement>(
      'input[type="radio"], input[type="checkbox"]',
    ),
  )
  if (inputs.length === 0) return null

  const first = inputs[0]
  const group = inputs.filter((input) => input.type === first.type)

  const labels = group
    .map(labelTextFor)
    .filter((label): label is string => Boolean(label))

  return labels.length > 0 ? labels : null
}

export const readOptionLabels = (element: HTMLElement): null | string[] => {
  let labels: null | string[] = null
  const tagName = element.tagName?.toLowerCase()

  if (tagName === 'select') {
    labels = fromSelect(element as HTMLSelectElement)
  } else if (
    tagName === 'input' &&
    ((element as HTMLInputElement).type === 'radio' ||
      (element as HTMLInputElement).type === 'checkbox')
  ) {
    labels = fromGroup(element as HTMLInputElement)
  } else {
    // A container. A nested `<select>` wins over nested inputs: a wrapper around
    // one dropdown is the commoner shape, and a select cannot be part of a
    // radio group.
    const nested = element.querySelector<HTMLSelectElement>('select')
    labels = nested ? fromSelect(nested) : fromContainer(element)
  }

  if (!labels || labels.length === 0) return null
  return labels.slice(0, MAX_OPTIONS)
}

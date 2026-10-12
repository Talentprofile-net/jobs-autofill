const DISABILITY_AUTOMATION_ID_SUFFIX = '-disability'
const DISABILITY_FIELD_NAME = 'disability'

export const fixedFieldName = (el: Element): string | null =>
  (el.getAttribute('data-automation-id') ?? '').endsWith(DISABILITY_AUTOMATION_ID_SUFFIX) ? DISABILITY_FIELD_NAME : null

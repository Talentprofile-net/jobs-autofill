const hasClass = (cls: string): string =>
  `contains(concat(' ', normalize-space(@class), ' '), ' ${cls} ')`

const hasClassPrefix = (prefix: string): string =>
  `(${hasClass(prefix)} or contains(@class, '${prefix}--') or contains(@class, '${prefix}__'))`

export const xpaths = {
  TEXT_INPUT: [
    `.//div`,
    `[${hasClassPrefix('text-input-wrapper')}]`,
    `[.//input[@type="text"]]`,
  ].join(''),
  NUMBER_INPUT: [
    `.//div`,
    `[${hasClassPrefix('text-input-wrapper')}]`,
    `[.//input[@type="number"]]`,
  ].join(''),
  TEXTAREA: [
    `.//div`,
    `[${hasClassPrefix('text-input-wrapper')}]`,
    `[.//textarea]`,
  ].join(''),
  FILE: [`.//div[${hasClassPrefix('file-upload')}]`].join(''),
  DROPDOWN_SEARCHABLE: [
    `.//div`,
    `[${hasClassPrefix('select')}]`,
    `[.//button[@aria-label="Toggle flyout"]]`,
    `[not(.//div[contains(@class, "is-multi")])]`,
  ].join(''),
  ADDRESS_SEARCHABLE: [
    `.//div`,
    `[${hasClassPrefix('select')}]`,
    `[not(.//button[@aria-label="Toggle flyout"])]`,
  ].join(''),
  DROPDOWN_MULTI_SEARCHABLE: [
    `.//div`,
    `[${hasClassPrefix('select')}]`,
    `[.//button[@aria-label="Toggle flyout"]]`,
    `[.//div[contains(@class, "is-multi")]]`,
  ].join(''),
  CHECKBOX_MULTI: [
    `.//fieldset`,
    `[${hasClassPrefix('checkbox')}]`,
    `[count(.//input[@type="checkbox"]) > 1]`,
  ].join(''),
  CHECKBOX_BOOLEAN: [
    `.//fieldset`,
    `[${hasClassPrefix('checkbox')}]`,
    `[count(.//input[@type="checkbox"]) = 1]`,
  ].join(''),
}
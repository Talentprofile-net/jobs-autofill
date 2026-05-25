const hasClass = (cls: string): string =>
  `contains(concat(' ', normalize-space(@class), ' '), ' ${cls} ')`

export const xpaths = {
  TEXT_INPUT: [
    `.//div[${hasClass('text-input-wrapper')}]`,
    `[.//input[@type="text"]]`,
  ].join(''),
  NUMBER_INPUT: [
    `.//div[${hasClass('text-input-wrapper')}]`,
    `[.//input[@type="number"]]`,
  ].join(''),
  TEXTAREA: [
    `.//div[${hasClass('text-input-wrapper')}]`,
    `[.//textarea]`,
  ].join(''),
  FILE: [`.//div[${hasClass('file-upload')}]`].join(''),
  DROPDOWN_SEARCHABLE: [
    `.//div`,
    `[${hasClass('select')}]`,
    `[.//button[@aria-label="Toggle flyout"]]`,
    `[not(.//div[contains(@class, "is-multi")])]`,
  ].join(''),
  ADDRESS_SEARCHABLE: [
    `.//div`,
    `[${hasClass('select')}]`,
    `[not(.//button[@aria-label="Toggle flyout"])]`,
  ].join(''),
  DROPDOWN_MULTI_SEARCHABLE: [
    `.//div`,
    `[${hasClass('select')}]`,
    `[.//button[@aria-label="Toggle flyout"]]`,
    `[.//div[contains(@class, "is-multi")]]`,
  ].join(''),
  CHECKBOX_MULTI: [
    `.//fieldset`,
    `[${hasClass('checkbox')}]`,
    `[count(.//input[@type="checkbox"]) > 1]`,
  ].join(''),
  CHECKBOX_BOOLEAN: [
    `.//fieldset`,
    `[${hasClass('checkbox')}]`,
    `[count(.//input[@type="checkbox"]) = 1]`,
  ].join(''),
}
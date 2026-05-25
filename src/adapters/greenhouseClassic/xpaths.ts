const hasClass = (cls: string): string =>
  `contains(concat(' ', normalize-space(@class), ' '), ' ${cls} ')`

export const xpaths = {
  TEXT_FIELD: [
    `.//div[${hasClass('field')}]`,
    "[(./input[@type='text']) | (./label/input[@type='text']) ]",
    `[not(.//input[@placeholder="MM"])]`,
    `[not(.//input[@placeholder="YYYY"])]`,
  ].join(''),
  SINGLE_FILE_UPLOAD: [
    `.//div[${hasClass('field')}]`,
    "[.//div[contains(@class, 'drop-zone')]]",
  ].join(''),
  ADDRESS_SEARCH_FIELD: [
    `.//div[${hasClass('field')}]`,
    '[.//auto-complete]',
  ].join(''),
  SIMPLE_DROPDOWN: [
    `.//div[${hasClass('field')}]`,
    "[.//div[contains(@class, 'select2-container')]]",
    "[not(.//div[contains(@class, 'select2-container-multi')])]",
    `[.//select]`,
  ].join(''),
  DROPDOWN_MULTI: [
    `.//div[${hasClass('field')}]`,
    "[.//div[contains(@class, 'select2-container-multi')]]",
    `[.//select]`,
  ].join(''),
  DROPDOWN_SEARCHABLE: [
    `.//div[${hasClass('field')}]`,
    "[.//div[contains(@class, 'select2-container')]]",
    `[not(.//select)]`,
  ].join(''),
  BASIC_SELECT: [
    `.//div[${hasClass('field')}]`,
    '[.//select]',
    "[not(.//div[contains(@class, 'select2-container')])]",
  ].join(''),
  TEXTAREA: [
    `.//div[${hasClass('field')}]`,
    '[.//textarea]',
  ].join(''),
  MULTI_CHECKBOX: [
    `.//div[${hasClass('field')}]`,
    "[count(.//input[@type='checkbox']) > 1]",
  ].join(''),
  MONTH_YEAR: [
    `.//div[${hasClass('field')}]`,
    `[.//input[@type="text"][@placeholder="MM"]]`,
    `[.//input[@type="text"][@placeholder="YYYY"]]`,
  ].join(''),
}
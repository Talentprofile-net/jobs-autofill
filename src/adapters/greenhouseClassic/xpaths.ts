const hasClass = (cls: string): string =>
  `contains(concat(' ', normalize-space(@class), ' '), ' ${cls} ')`

export const xpaths = {
  TEXT_FIELD: [
    `.//div[${hasClass('field')}]`,
    "[(./input[@type='text']) | (./label/input[@type='text']) ]",
    `[not(.//input[contains(translate(@placeholder, 'MY', 'my'), 'mm')])]`,
    `[not(.//input[contains(translate(@placeholder, 'MY', 'my'), 'yyyy')])]`,
    `[not(.//input[@aria-label='Month'])]`,
    `[not(.//input[@aria-label='Year'])]`,
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
  SINGLE_CHECKBOX: [
    `.//div[${hasClass('field')}]`,
    "[count(.//input[@type='checkbox']) = 1]",
  ].join(''),
  MONTH_YEAR: [
    `.//div[${hasClass('field')}]`,
    `[count(.//input[@type="text"]) >= 2]`,
    `[count(.//input[@type="text"][@maxlength="2"]) >= 1 or .//input[@type="text"][contains(translate(@placeholder, 'M', 'm'), 'm')]]`,
    `[count(.//input[@type="text"][@maxlength="4"]) >= 1 or .//input[@type="text"][contains(translate(@placeholder, 'Y', 'y'), 'y')]]`,
  ].join(''),
}
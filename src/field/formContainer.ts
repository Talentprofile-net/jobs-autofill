import { detectAts } from '~/core/ats'
import { getElement, getElements } from '~/core/getElements'
import { querySelectorAllDeep } from '~/core/shadowDom'
import type { AtsName } from './types'

const FORM_CONTAINER_XPATHS: Record<Exclude<AtsName, 'generic'>, string> = {
  greenhouseClassic: ".//form[@id='application_form'] | .//div[@id='application']",
  greenhouseReact:
    ".//div[contains(concat(' ', normalize-space(@class), ' '), ' application--container ')]",
  workday:
    ".//div[@data-automation-id='applicationPage' or @data-automation-id='jobApplyPage' or @role='main']",
}

const GENERIC_FORM_CONTAINER_XPATH = ".//form | .//div[@role='form']"

const GENERIC_CONTROL_SELECTOR =
  'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="search"]),' +
  'select, textarea'

const MIN_GENERIC_CONTROLS = 3

const detectGenericFormContainer = (): HTMLElement =>
  getElements(document, GENERIC_FORM_CONTAINER_XPATH).reduce(
    (best, el) => {
      const count = querySelectorAllDeep(el, GENERIC_CONTROL_SELECTOR).length
      return count > best.count ? { count, el } : best
    },
    { count: MIN_GENERIC_CONTROLS - 1, el: document.documentElement },
  ).el

export const detectFormContainer = (ats: AtsName = detectAts()): HTMLElement =>
  ats === 'generic'
    ? detectGenericFormContainer()
    : getElement(document, FORM_CONTAINER_XPATHS[ats]) ?? document.documentElement

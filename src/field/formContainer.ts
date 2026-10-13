import { detectAts } from '~/core/ats'
import { getElement } from '~/core/getElements'
import type { AtsName } from './types'

const FORM_CONTAINER_XPATHS: Record<Exclude<AtsName, 'generic'>, string> = {
  greenhouseClassic: ".//form[@id='application_form'] | .//div[@id='application']",
  greenhouseReact:
    ".//div[contains(concat(' ', normalize-space(@class), ' '), ' application--container ')]",
  workday:
    ".//div[@data-automation-id='applicationPage' or @data-automation-id='jobApplyPage' or @role='main']",
}

const GENERIC_FORM_CONTAINER_XPATH = ".//form | .//div[@role='form']"

export const detectFormContainer = (ats: AtsName = detectAts()): HTMLElement =>
  getElement(document, ats === 'generic' ? GENERIC_FORM_CONTAINER_XPATH : FORM_CONTAINER_XPATHS[ats]) ?? document.documentElement

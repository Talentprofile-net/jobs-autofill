import { getElement, getElements } from '~/core/getElements'
import { composedParent } from '~/core/shadowDom'
import { isVisible } from '~/field/fieldVisibility'

export type AtsFieldSpec = {
  xpath: string
  fieldType: string
  fieldName: (element: HTMLElement) => string
  fillable: (element: HTMLElement) => boolean
}

const DEFAULT_LABEL_XPATH = [
  ".//*[self::label or self::legend]",
  "[.//text()[(normalize-space() != '')]]",
].join('')

export const labelledFieldName = (element: HTMLElement, labelXpath: string = DEFAULT_LABEL_XPATH): string => {
  const labelText = getElement(element, labelXpath)?.innerText?.trim()
  if (labelText) return labelText
  const ariaLabel = element.getAttribute('aria-label')?.trim()
  if (ariaLabel) return ariaLabel
  return getElement(element, './/*[@placeholder]')?.getAttribute('placeholder')?.trim() ?? ''
}

export const nearestMapped = (element: HTMLElement, values: ReadonlyMap<Element, string>): string => {
  for (let node: Node | null = element; node; node = composedParent(node)) {
    const value = node instanceof Element ? values.get(node) : undefined
    if (value) return value
  }
  return ''
}

export const alwaysFillable = (): boolean => true

export const neverFillable = (): boolean => false

export const holdsFileInput = (element: HTMLElement): boolean => element.querySelector('input[type="file"]') !== null

export const atsSpec = (xpath: string, fieldType: string, overrides: Partial<Pick<AtsFieldSpec, 'fieldName' | 'fillable'>> = {}): AtsFieldSpec => ({
  fieldName: (element) => labelledFieldName(element),
  fillable: alwaysFillable,
  fieldType,
  xpath,
  ...overrides,
})

export const walkAtsCandidates = (
  specs: ReadonlyArray<AtsFieldSpec>,
  root: Node,
  isClaimed: (element: HTMLElement) => boolean,
  visit: (index: number, element: HTMLElement) => void,
): void => {
  specs.forEach((spec, index) => {
    for (const element of getElements(root, spec.xpath)) {
      if (isClaimed(element) || !isVisible(element)) continue
      visit(index, element)
    }
  })
}

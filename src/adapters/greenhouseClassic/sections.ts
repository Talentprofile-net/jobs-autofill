import { getElement, getElements } from '~/core/getElements'

const SECTION_CLASSES = `[@class="education" or @class="employment"]`
const SECTION_WRAPPER_IDS = `[@id="education_section" or @id="employment_section"]`

const registeredWrappers = new WeakMap<HTMLElement, MutationObserver>()

export const SECTION_WRAPPER_XPATH = `.//div${SECTION_WRAPPER_IDS}`

export const wrapperSectionNumbers = (wrapper: HTMLElement): Map<HTMLElement, string> => {
  const type = wrapper.id.split('_')[0]
  return new Map(getElements(wrapper, `.//div${SECTION_CLASSES}`).map((el, index) => [el, `${type} ${index + 1}`]))
}

export class Sections {
  static XPATH = SECTION_WRAPPER_XPATH
  element: HTMLElement

  static autoDiscover(node: Node = document): void {
    const elements = getElements(node, this.XPATH)
    elements.forEach((el) => {
      if (!el.hasAttribute('data-tp-section-wrapper')) {
        new Sections(el)
      }
    })
  }

  constructor(element: HTMLElement) {
    this.element = element
    this.element.setAttribute('data-tp-section-wrapper', 'true')
    this.registerSections()
    this.observeForChanges()
  }

  private registerSections(): void {
    for (const [el, value] of wrapperSectionNumbers(this.element)) {
      if (el.getAttribute('jaf-section') !== value) el.setAttribute('jaf-section', value)
    }
  }

  private observeForChanges(): void {
    const previous = registeredWrappers.get(this.element)
    if (previous) previous.disconnect()
    const observer = new MutationObserver((mutations) => {
      if (!document.documentElement.contains(this.element)) {
        observer.disconnect()
        registeredWrappers.delete(this.element)
        return
      }
      const sectionChanged = mutations.some((m) => {
        if (m.type === 'childList') return true
        if (m.type === 'attributes') {
          const current =
            m.attributeName === null
              ? null
              : (m.target as HTMLElement).getAttribute(m.attributeName)
          return current !== m.oldValue
        }
        return false
      })
      if (sectionChanged) {
        this.registerSections()
      }
    })
    observer.observe(this.element, {
      childList: true,
      attributes: true,
      attributeFilter: ['id', 'class'],
      attributeOldValue: true,
      subtree: true,
    })
    registeredWrappers.set(this.element, observer)
  }
}
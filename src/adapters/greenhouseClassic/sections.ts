import { getElement, getElements } from '~/core/getElements'

const SECTION_CLASSES = `[@class="education" or @class="employment"]`
const SECTION_WRAPPER_IDS = `[@id="education_section" or @id="employment_section"]`

const registeredWrappers = new WeakMap<HTMLElement, MutationObserver>()

export class Sections {
  static XPATH = `.//div${SECTION_WRAPPER_IDS}`
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

  private get sectionType(): string {
    return this.element.id.split('_')[0]
  }

  private registerSections(): void {
    const sectionElements = getElements(this.element, `.//div${SECTION_CLASSES}`)
    sectionElements.forEach((el, index) => {
      const newValue = `${this.sectionType} ${index + 1}`
      if (el.getAttribute('jaf-section') !== newValue) {
        el.setAttribute('jaf-section', newValue)
      }
    })
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
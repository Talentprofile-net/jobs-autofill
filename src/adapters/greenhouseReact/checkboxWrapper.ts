import { getElement } from '~/core/getElements'

export class CheckboxWrapperContainer {
  element: HTMLElement
  constructor(element: HTMLElement) {
    this.element = element
  }
  get labelElement(): HTMLLabelElement | null {
    return getElement(this.element, `.//label`) as HTMLLabelElement | null
  }
  get value(): string {
    return this.labelElement?.innerText ?? ''
  }
  get inputElement(): HTMLInputElement | null {
    return getElement(this.element, `.//input`) as HTMLInputElement | null
  }
  get checked(): boolean {
    return this.inputElement?.checked ?? false
  }
  check(): void {
    if (!this.checked) this.inputElement?.click()
  }
  uncheck(): void {
    if (this.checked) this.inputElement?.click()
  }
}
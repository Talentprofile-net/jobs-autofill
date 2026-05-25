import { FIELD_MARKER_ATTR } from '~/config'
import { getElement, getElements } from '~/core/getElements'
import { resolveValueForField } from '~/bridge/mainBridge'
import { registerField, unregisterField } from '~/field/registry'
import { isPlaceholderText } from '~/core/match'
import type { PickerMode, ProfileValue, FillOutcome } from './types'
import { mountPickerIcon } from '~/ui/picker/iconMount'

export const isRegistered = (el: HTMLElement): boolean =>
  el.hasAttribute(FIELD_MARKER_ATTR)

export const isInsideRegistered = (el: HTMLElement): boolean => {
  if (el.hasAttribute(FIELD_MARKER_ATTR)) return true
  return el.closest(`[${FIELD_MARKER_ATTR}]`) !== null
}

export const isVisible = (el: HTMLElement): boolean => {
  if (typeof (el as any).checkVisibility === 'function') {
    return (el as any).checkVisibility({
      visibilityProperty: true,
      opacityProperty: true,
    })
  }
  const rect = el.getBoundingClientRect()
  if (rect.height <= 0 || rect.width <= 0) return false
  const style = window.getComputedStyle(el)
  if (style.visibility === 'hidden' || style.display === 'none') return false
  if (parseFloat(style.opacity || '1') === 0) return false
  return true
}

export abstract class BaseField {
  static XPATH: string
  fieldType: string = 'Unknown'
  element: HTMLElement
  uuid: string
  private widgetHandle: { destroy: () => void } | null = null
  private fillBusy = false
  private initialized = false

  constructor(element: HTMLElement) {
    this.element = element
    this.uuid = crypto.randomUUID()
    this.element.setAttribute(FIELD_MARKER_ATTR, this.uuid)
  }

  static autoDiscover<T extends BaseField>(
    this: new (el: HTMLElement) => T,
    node: Node = document,
  ): void {
    const ctor = this as unknown as typeof BaseField
    const elements = getElements(node, ctor.XPATH)
    elements.forEach((el) => {
      if (isRegistered(el) || !isVisible(el)) return
      const instance = new (ctor as unknown as new (el: HTMLElement) => T)(el)
      instance.init()
    })
  }

  init(): void {
    if (this.initialized) return
    this.initialized = true
    try {
      this.mountWidget()
    } catch (e) {
      console.warn('[TP] mountWidget failed', e)
    }
    registerField(this)
  }

  get labelElement(): HTMLElement | null {
    const xpath = [
      ".//*[self::label or self::legend]",
      "[.//text()[(normalize-space() != '')]]",
    ].join('')
    return getElement(this.element, xpath)
  }

  get fieldName(): string {
    const labelText = this.labelElement?.innerText?.trim()
    if (labelText) return labelText
    const ariaLabel = this.element.getAttribute('aria-label')?.trim()
    if (ariaLabel) return ariaLabel
    const placeholderEl = getElement(this.element, './/*[@placeholder]')
    const placeholder = placeholderEl?.getAttribute('placeholder')?.trim()
    if (placeholder) return placeholder
    return ''
  }

  get section(): string {
    return ''
  }

  get pickerMode(): PickerMode {
    return 'full'
  }

  protected canFill(): boolean {
    return true
  }

  isFillable(): boolean {
    return this.canFill()
  }

  protected mountWidget(): void {
    const anchor = this.getWidgetAnchor()
    if (!anchor) return
    this.widgetHandle = mountPickerIcon({
      field: anchor,
      fieldUuid: this.uuid,
      fieldName: this.fieldName,
      fieldType: this.fieldType,
      section: this.section,
      pickerMode: this.pickerMode,
    })
  }

  protected getWidgetAnchor(): HTMLElement | null {
    return this.element
  }

  destroy(): void {
    this.widgetHandle?.destroy()
    this.widgetHandle = null
    if (document.documentElement.contains(this.element)) {
      this.element.removeAttribute(FIELD_MARKER_ATTR)
    }
    unregisterField(this.uuid)
  }

  abstract currentValue(): unknown
  abstract fill(value: ProfileValue): Promise<boolean>

  async fillFromResolved(
    value: ProfileValue,
    force = false,
  ): Promise<FillOutcome> {
    if (this.fillBusy) {
      return { status: 'skipped', reason: 'busy' }
    }
    this.fillBusy = true
    try {
      return await this.applyResolvedValue(value, force)
    } finally {
      this.fillBusy = false
    }
  }

  async resolveAndFill(force = false): Promise<FillOutcome> {
    if (this.fillBusy) {
      return { status: 'skipped', reason: 'busy' }
    }
    this.fillBusy = true
    try {
      const value = await resolveValueForField(
        this.fieldName,
        this.fieldType,
        this.section,
      )
      return await this.applyResolvedValue(value, force)
    } finally {
      this.fillBusy = false
    }
  }

  private async applyResolvedValue(
    value: ProfileValue,
    force: boolean,
  ): Promise<FillOutcome> {
    if (value.kind === 'timeout') {
      return { status: 'skipped', reason: 'timeout' }
    }
    if (value.kind === 'unsupported') {
      return { status: 'skipped', reason: 'unsupported' }
    }
    if (value.kind === 'string' && value.confidence === 'guess' && !force) {
      return { status: 'skipped', reason: 'guess' }
    }
    let safeShould = true
    try {
      safeShould = this.shouldOverwrite(value)
    } catch {
      safeShould = true
    }
    if (!force && !safeShould) {
      return { status: 'skipped', reason: 'has-value' }
    }
    try {
      const changed = await this.fill(value)
      if (!changed) {
        return { status: 'skipped', reason: 'no-match' }
      }
      return { status: 'filled' }
    } catch (e) {
      return { status: 'failed', error: (e as Error).message }
    }
  }

  protected shouldOverwrite(target: ProfileValue): boolean {
    const current = this.currentValue()
    if (target.kind === 'boolean') {
      if (typeof current === 'boolean') return current !== target.value
      return true
    }
    if (typeof current === 'string') return isPlaceholderText(current)
    if (Array.isArray(current)) {
      if (current.length === 0) return true
      const hasMissingPart = current.some((v) =>
        isPlaceholderText(String(v ?? '')),
      )
      return hasMissingPart
    }
    return true
  }
}
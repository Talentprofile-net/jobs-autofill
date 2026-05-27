import { FIELD_MARKER_ATTR } from '~/config'
import { getElement, getElements } from '~/core/getElements'
import { resolveValueForField } from '~/bridge/mainBridge'
import { registerField, unregisterField } from '~/field/registry'
import {
  registerFieldForCapture,
  unregisterFieldFromCapture,
} from '~/capture/captureBuffer'
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

const normalize = (s: string): string =>
  s.replace(/\s+/g, ' ').trim().toLowerCase()

const desiredSetForOverwrite = (target: ProfileValue): Set<string> | null => {
  if (target.kind === 'multiChoice') {
    return new Set(target.preferred)
  }
  if (target.kind === 'choice') {
    return new Set([target.preferred])
  }
  return null
}

const isAlreadyCorrect = (
  current: unknown,
  target: ProfileValue,
): boolean => {
  if (target.kind === 'boolean') {
    return typeof current === 'boolean' && current === target.value
  }
  if (target.kind === 'string') {
    if (typeof current !== 'string') return false
    return normalize(current) === normalize(target.value)
  }
  if (target.kind === 'choice') {
    if (typeof current === 'string') {
      const n = normalize(current)
      if (n === normalize(target.preferred)) return true
      return target.fallbacks.some((f) => normalize(f) === n)
    }
    if (Array.isArray(current) && current.length === 1) {
      const n = normalize(String(current[0] ?? ''))
      if (n === normalize(target.preferred)) return true
      return target.fallbacks.some((f) => normalize(f) === n)
    }
    return false
  }
  if (target.kind === 'multiChoice') {
    if (!Array.isArray(current)) return false
    const currentNorm = new Set(current.map((v) => normalize(String(v ?? ''))))
    const desiredNorm = new Set(target.preferred.map((v) => normalize(v)))
    if (currentNorm.size !== desiredNorm.size) return false
    for (const want of desiredNorm) {
      if (!currentNorm.has(want)) return false
    }
    return true
  }
  if (target.kind === 'date') {
    if (!Array.isArray(current)) return false
    const parts = current.map((v) => String(v ?? ''))
    const normalizePart = (s: string): string => {
      const n = parseInt(s, 10)
      return Number.isFinite(n) ? String(n) : s
    }
    const targetMonth = target.month
      ? normalizePart(target.month)
      : undefined
    const targetDay = target.day ? normalizePart(target.day) : undefined
    const targetYear = normalizePart(target.year)
    if (target.day && parts.length === 3) {
      return (
        normalizePart(parts[0]) === targetMonth &&
        normalizePart(parts[1]) === targetDay &&
        normalizePart(parts[2]) === targetYear
      )
    }
    if (!target.day && parts.length === 2) {
      return (
        normalizePart(parts[0]) === targetMonth &&
        normalizePart(parts[1]) === targetYear
      )
    }
    return false
  }
  return false
}

type ResolverOutcomeValue = 'filled' | 'skipped' | 'unsupported' | 'failed'

export type CaptureRecord = {
  fieldName: string
  fieldType: string
  section: string
  currentValue: unknown
  source: 'manual' | 'correction' | 'resolver_filled' | 'resolver_skipped'
  resolverOutcome: ResolverOutcomeValue
  profileField: string | null
}

export abstract class BaseField {
  static XPATH: string
  fieldType: string = 'Unknown'
  element: HTMLElement
  uuid: string
  destructiveByDefault: boolean = true
  private widgetHandle: { destroy: () => void; host: HTMLElement | null } | null =
    null
  private fillBusy = false
  private initialized = false

  private filledFromLearnedAnswerId: string | null = null
  private wasUnsupportedAtFill = false
  private valueAtFillTime: unknown = null
  private lastResolverOutcome: ResolverOutcomeValue | null = null
  private lastProfileField: string | null = null
  private snapshotTaken = false
  private userInteracted = false
  private interactionListenersAttached = false
  private interactionCleanup: Array<() => void> = []

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
    registerFieldForCapture(this)
    this.attachInteractionListeners()
  }

  get widgetHost(): HTMLElement | null {
    return this.widgetHandle?.host ?? null
  }

  hasLiveWidget(): boolean {
    const host = this.widgetHost
    if (!host) return false
    return document.documentElement.contains(host)
  }

  remountWidget(): void {
    if (this.widgetHandle) {
      try {
        this.widgetHandle.destroy()
      } catch (e) {
        console.warn('[TP] widget destroy during remount failed', e)
      }
      this.widgetHandle = null
    }
    try {
      this.mountWidget()
    } catch (e) {
      console.warn('[TP] widget remount failed', e)
    }
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

  private attachInteractionListeners(): void {
    if (this.interactionListenersAttached) return
    this.interactionListenersAttached = true
    const markInteracted = () => {
      this.userInteracted = true
      this.ensureFillSnapshot()
    }
    const handler = (e: Event) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (!this.element.contains(target) && target !== this.element) return
      markInteracted()
    }
    this.element.addEventListener('input', handler, true)
    this.element.addEventListener('change', handler, true)
    this.element.addEventListener('click', handler, true)
    this.element.addEventListener('keydown', handler, true)
    this.interactionCleanup.push(() => {
      this.element.removeEventListener('input', handler, true)
      this.element.removeEventListener('change', handler, true)
      this.element.removeEventListener('click', handler, true)
      this.element.removeEventListener('keydown', handler, true)
    })
  }

  destroy(): void {
    this.widgetHandle?.destroy()
    this.widgetHandle = null
    for (const cleanup of this.interactionCleanup) cleanup()
    this.interactionCleanup = []
    unregisterFieldFromCapture(this)
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
      return { status: 'unsupported' }
    }
    if (value.kind === 'string' && value.confidence === 'guess' && !force) {
      return { status: 'skipped', reason: 'guess' }
    }

    let alreadyCorrect = false
    try {
      alreadyCorrect = isAlreadyCorrect(this.currentValue(), value)
    } catch {
      alreadyCorrect = false
    }
    if (alreadyCorrect) {
      return { status: 'skipped', reason: 'already-correct' }
    }

    let safeShould = true
    try {
      safeShould = this.shouldOverwrite(value, force)
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

  protected shouldOverwrite(target: ProfileValue, force: boolean = false): boolean {
    const current = this.currentValue()

    if (target.kind === 'boolean') {
      if (typeof current === 'boolean') return current !== target.value
      return true
    }

    const desired = desiredSetForOverwrite(target)
    if (desired && Array.isArray(current)) {
      if (current.length === 0) return true

      if (!this.destructiveByDefault && !force) {
        const currentSet = new Set(
          current.map((v) => normalize(String(v ?? ''))),
        )
        const desiredNorm = new Set(
          Array.from(desired).map((v) => normalize(v)),
        )
        for (const want of desiredNorm) {
          if (!currentSet.has(want)) return true
        }
        return false
      }

      const currentSet = new Set(
        current.map((v) => normalize(String(v ?? ''))),
      )
      const desiredNorm = new Set(
        Array.from(desired).map((v) => normalize(v)),
      )
      for (const want of desiredNorm) {
        if (!currentSet.has(want)) return true
      }
      for (const have of currentSet) {
        if (!desiredNorm.has(have)) return true
      }
      return false
    }

    if (typeof current === 'string') return isPlaceholderText(current)

    if (Array.isArray(current)) {
      if (current.length === 0) return true
      const hasMissingPart = current.some((v) =>
        isPlaceholderText(String(v ?? '')),
      )
      return hasMissingPart
    }

    if (typeof current === 'boolean') return true

    return true
  }

  recordLearnedAnswerFill(answerId: string): void {
    this.filledFromLearnedAnswerId = answerId
    this.ensureFillSnapshot()
  }

  markUnsupportedForCapture(): void {
    this.wasUnsupportedAtFill = true
    this.ensureFillSnapshot()
  }

  recordResolverOutcome(
    outcome: ResolverOutcomeValue,
    profileField: string | null = null,
  ): void {
    this.lastResolverOutcome = outcome
    if (profileField) this.lastProfileField = profileField
    this.ensureFillSnapshot()
  }

  private ensureFillSnapshot(): void {
    if (this.snapshotTaken) return
    this.snapshotTaken = true
    this.valueAtFillTime = this.snapshotCurrentValue()
  }

  private snapshotCurrentValue(): unknown {
    try {
      const v = this.currentValue()
      if (Array.isArray(v)) return [...v]
      return v
    } catch {
      return null
    }
  }

  collectCapture(
    resolverOutcomeOverride: ResolverOutcomeValue | null,
  ): CaptureRecord | null {
    if (!this.userInteracted && this.lastResolverOutcome === null) {
      return null
    }

    const current = this.snapshotCurrentValue()
    if (current === null || current === undefined) return null
    if (!this.hasMeaningfulValue(current)) return null

    const effectiveOutcome: ResolverOutcomeValue =
      resolverOutcomeOverride ??
      this.lastResolverOutcome ??
      (this.wasUnsupportedAtFill
        ? 'unsupported'
        : this.filledFromLearnedAnswerId
          ? 'filled'
          : 'unsupported')

    const userEdited =
      this.snapshotTaken &&
      !this.valuesEqual(current, this.valueAtFillTime)

    let source: CaptureRecord['source']
    if (this.filledFromLearnedAnswerId && userEdited) {
      source = 'correction'
    } else if (effectiveOutcome === 'filled' && this.lastProfileField === null && this.userInteracted && userEdited) {
      source = 'correction'
    } else if (effectiveOutcome === 'filled') {
      source = 'resolver_filled'
    } else if (effectiveOutcome === 'skipped') {
      source = 'resolver_skipped'
    } else if (this.userInteracted) {
      source = 'manual'
    } else {
      source = 'resolver_skipped'
    }

    if (
      effectiveOutcome === 'filled' &&
      this.filledFromLearnedAnswerId &&
      !userEdited
    ) {
      return null
    }

    return {
      currentValue: current,
      fieldName: this.fieldName,
      fieldType: this.fieldType,
      profileField: this.lastProfileField,
      resolverOutcome: effectiveOutcome,
      section: this.section,
      source,
    }
  }

  collectCaptureIfDirty(): {
    fieldName: string
    fieldType: string
    section: string
    currentValue: unknown
    source: 'manual' | 'correction'
    profileField: string | null
  } | null {
    if (!this.snapshotTaken && !this.userInteracted) return null
    const result = this.collectCapture(null)
    if (!result) return null
    if (result.source !== 'manual' && result.source !== 'correction') return null
    return {
      currentValue: result.currentValue,
      fieldName: result.fieldName,
      fieldType: result.fieldType,
      profileField: result.profileField,
      section: result.section,
      source: result.source,
    }
  }

  private hasMeaningfulValue(v: unknown): boolean {
    if (typeof v === 'boolean') return true
    if (typeof v === 'string') {
      const trimmed = v.trim()
      if (trimmed.length === 0) return false
      return !isPlaceholderText(trimmed)
    }
    if (Array.isArray(v)) {
      if (v.length === 0) return false
      return v.some((item) => {
        if (typeof item === 'string') {
          const trimmed = item.trim()
          if (trimmed.length === 0) return false
          return !isPlaceholderText(trimmed)
        }
        return item !== null && item !== undefined
      })
    }
    return v !== null && v !== undefined
  }

  private valuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true
    if (a === null || a === undefined || b === null || b === undefined) {
      return a === b
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false
      for (let i = 0; i < a.length; i++) {
        if (!this.valuesEqual(a[i], b[i])) return false
      }
      return true
    }
    if (typeof a === 'object' && typeof b === 'object') {
      try {
        return JSON.stringify(a) === JSON.stringify(b)
      } catch {
        return false
      }
    }
    return false
  }
}
import { mount, unmount } from 'svelte'
import PickerIcon from './PickerIcon.svelte'
import { openPicker } from './pickerController'
import type { PickerMode } from '~/field/types'
import {
  applyAppearanceVars,
  findIconDonor,
  readDonorAppearance,
} from '~/ui/donorStyle'
import { scoreSendButton } from '~/ui/sendButtonScoring'

type MountOptions = {
  field: HTMLElement
  fieldUuid: string
  fieldName: string
  fieldType: string
  section: string
  pickerMode: PickerMode
}

const TARGET_GAP_PX = 6

const STYLE_INLINE = `
:host {
  all: initial;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: center;
  flex-shrink: 0;
}
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--tp-icon-bg, transparent);
  color: var(--tp-icon-color, currentColor);
  border: none;
  border-radius: var(--tp-icon-radius, 6px);
  padding: var(--tp-icon-padding, 6px);
  cursor: pointer;
  line-height: 0;
  transition: background 120ms ease;
}
button:hover {
  background: var(--tp-icon-hover-bg, color-mix(in srgb, currentColor 12%, transparent));
}
button svg { display: block; }
`

const STYLE_ABSOLUTE = `
:host {
  all: initial;
  position: absolute;
  top: 50%;
  right: 4px;
  transform: translateY(-50%);
  z-index: 2147483646;
  pointer-events: auto;
}
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: hsl(240 5.9% 10%);
  color: hsl(0 0% 98%);
  border: none;
  border-radius: 6px;
  padding: 4px 6px;
  cursor: pointer;
  line-height: 0;
  transition: background 120ms ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}
button:hover { background: hsl(240 5% 26%); }
button svg { display: block; }
`

const supportsAdoptedStyleSheets =
  typeof CSSStyleSheet !== 'undefined' &&
  'replaceSync' in CSSStyleSheet.prototype &&
  'adoptedStyleSheets' in Document.prototype

const sheetCache = new Map<string, CSSStyleSheet>()

const sheetFor = (text: string): CSSStyleSheet | null => {
  if (!supportsAdoptedStyleSheets) return null
  const cached = sheetCache.get(text)
  if (cached) return cached
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(text)
  sheetCache.set(text, sheet)
  return sheet
}

const applyStyles = (shadow: ShadowRoot, text: string): void => {
  const sheet = sheetFor(text)
  if (sheet) {
    ;(shadow as ShadowRoot & { adoptedStyleSheets: CSSStyleSheet[] }).adoptedStyleSheets = [sheet]
    return
  }
  const styleEl = document.createElement('style')
  styleEl.textContent = text
  shadow.appendChild(styleEl)
}

const INPUT_SELECTOR =
  'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="file"]):not([type="password"]),' +
  'textarea, [contenteditable="true"], [contenteditable=""], [role="textbox"]'

const findHostAnchor = (field: HTMLElement): HTMLElement | null => {
  if (field.matches(INPUT_SELECTOR)) return field
  return field.querySelector<HTMLElement>(INPUT_SELECTOR)
}

const MAX_COMPOSER_DEPTH = 8
const MAX_ROW_WALK_DEPTH = 10
const MIN_SEND_SCORE = 4

type Candidate = {
  el: HTMLElement
  rect: DOMRect
  sendScore: number
}

const collectCandidateButtons = (
  composer: HTMLElement,
  anchor: HTMLElement,
): Candidate[] => {
  const buttons = Array.from(
    composer.querySelectorAll<HTMLElement>('button, [role="button"]'),
  )
  const out: Candidate[] = []
  for (const btn of buttons) {
    if (btn === anchor || btn.contains(anchor) || anchor.contains(btn)) continue
    if (btn.getAttribute('data-tp-field-widget') === 'true') continue
    if (btn.closest('[data-tp-field-widget="true"]')) continue
    if (btn.hasAttribute('hidden')) continue
    if (btn.getAttribute('aria-hidden') === 'true') continue
    const rect = btn.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    out.push({ el: btn, rect, sendScore: scoreSendButton(btn) })
  }
  return out
}

const findComposerRoot = (anchor: HTMLElement): HTMLElement | null => {
  let node: HTMLElement | null = anchor.parentElement
  let depth = 0
  while (node && depth < MAX_COMPOSER_DEPTH) {
    const candidates = collectCandidateButtons(node, anchor)
    if (candidates.length > 0) return node
    node = node.parentElement
    depth++
  }
  return null
}

const findSendButton = (
  composer: HTMLElement,
  anchor: HTMLElement,
): HTMLElement | null => {
  const candidates = collectCandidateButtons(composer, anchor)
  if (candidates.length === 0) return null

  const anchorRect = anchor.getBoundingClientRect()
  const scored = candidates.filter((c) => c.sendScore >= MIN_SEND_SCORE)
  if (scored.length === 0) return null

  scored.sort((a, b) => {
    if (b.sendScore !== a.sendScore) return b.sendScore - a.sendScore
    return b.rect.right - a.rect.right
  })

  const top = scored[0]
  if (top.rect.right < anchorRect.left) return null

  return top.el
}

const isHorizontalFlexLike = (el: HTMLElement): boolean => {
  const style = window.getComputedStyle(el)
  const display = style.display
  if (display === 'flex' || display === 'inline-flex') {
    const dir = style.flexDirection || 'row'
    return dir === 'row' || dir === 'row-reverse'
  }
  if (display === 'grid' || display === 'inline-grid') {
    const rows = style.gridTemplateRows
    if (!rows || rows === 'none' || /^\s*[^\s]+\s*$/.test(rows)) return true
  }
  return false
}

const rowAutoDistributes = (el: HTMLElement): boolean => {
  const jc = window.getComputedStyle(el).justifyContent
  return jc === 'space-between' || jc === 'space-around' || jc === 'space-evenly'
}

const parsePx = (value: string): number => {
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : 0
}

const rowGapPx = (el: HTMLElement): number => {
  const s = window.getComputedStyle(el)
  const cg = parsePx(s.columnGap)
  if (cg > 0) return cg
  return parsePx(s.gap)
}

const looksActionable = (el: HTMLElement, exclude: HTMLElement): boolean => {
  if (el === exclude) return false
  if (el.contains(exclude)) return false
  if (el.getAttribute('data-tp-field-widget') === 'true') return false
  if (el.hasAttribute('hidden')) return false
  if (el.getAttribute('aria-hidden') === 'true') return false
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return false
  if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') return true
  if (el.tagName === 'INPUT') {
    const type = el.getAttribute('type')
    if (type === 'button' || type === 'submit') return true
  }
  if (el.querySelector('button, [role="button"]')) return true
  return false
}

type InsertionTarget = { row: HTMLElement; before: HTMLElement }

const findActionRowInsertion = (
  sendButton: HTMLElement,
  composer: HTMLElement,
): InsertionTarget | null => {
  const composerParent = composer.parentElement

  let branch: HTMLElement = sendButton
  let parent: HTMLElement | null = branch.parentElement
  let depth = 0
  while (parent && depth < MAX_ROW_WALK_DEPTH) {
    if (parent === composerParent || parent === document.body) break
    if (isHorizontalFlexLike(parent) && !rowAutoDistributes(parent)) {
      const children = Array.from(parent.children) as HTMLElement[]
      const hasSiblingAction = children.some(
        (child) => child !== branch && looksActionable(child, sendButton),
      )
      const hasGap = rowGapPx(parent) > 0
      if (hasSiblingAction || hasGap) {
        return { row: parent, before: branch }
      }
    }
    branch = parent
    parent = branch.parentElement
    depth++
  }

  branch = sendButton
  parent = branch.parentElement
  depth = 0
  while (parent && depth < MAX_ROW_WALK_DEPTH) {
    if (parent === composerParent || parent === document.body) break
    if (isHorizontalFlexLike(parent) && !rowAutoDistributes(parent)) {
      return { row: parent, before: branch }
    }
    branch = parent
    parent = branch.parentElement
    depth++
  }

  return null
}

const ensurePositioned = (el: HTMLElement): void => {
  const computed = window.getComputedStyle(el)
  if (computed.position === 'static') {
    el.style.position = 'relative'
  }
}

const applyInlineSpacing = (host: HTMLElement, row: HTMLElement): void => {
  const rowGap = rowGapPx(row)
  const extra = Math.max(0, TARGET_GAP_PX - rowGap)
  host.style.marginLeft = `${extra}px`
  host.style.marginRight = `${extra}px`
}

const mountAbsoluteInParent = (
  host: HTMLElement,
  anchor: HTMLElement,
  shadow: ShadowRoot,
): void => {
  applyStyles(shadow, STYLE_ABSOLUTE)
  const parent = anchor.parentElement ?? anchor
  ensurePositioned(parent)
  parent.appendChild(host)
}

export const mountPickerIcon = (
  opts: MountOptions,
): { destroy: () => void; host: HTMLElement } | null => {
  const anchor = findHostAnchor(opts.field)
  if (!anchor) return null

  const host = document.createElement('div')
  host.setAttribute('data-tp-field-widget', 'true')
  const shadow = host.attachShadow({ mode: 'open' })

  const mountTarget = document.createElement('div')
  shadow.appendChild(mountTarget)

  const forceAbsolute = opts.pickerMode === 'notesOnly'
  const composer = forceAbsolute ? null : findComposerRoot(anchor)
  const sendButton = composer ? findSendButton(composer, anchor) : null
  const insertion =
    composer && sendButton ? findActionRowInsertion(sendButton, composer) : null

  if (!forceAbsolute && insertion) {
    applyStyles(shadow, STYLE_INLINE)
    insertion.row.insertBefore(host, insertion.before)
    applyInlineSpacing(host, insertion.row)
    if (composer && sendButton) {
      const donor = findIconDonor(composer, sendButton)
      const appearance = readDonorAppearance(donor, composer)
      applyAppearanceVars(host, appearance, 'tp-icon')
    }
  } else if (!forceAbsolute && sendButton && sendButton.parentElement) {
    applyStyles(shadow, STYLE_INLINE)
    sendButton.parentElement.insertBefore(host, sendButton)
    applyInlineSpacing(host, sendButton.parentElement)
    if (composer) {
      const donor = findIconDonor(composer, sendButton)
      const appearance = readDonorAppearance(donor, composer)
      applyAppearanceVars(host, appearance, 'tp-icon')
    }
  } else {
    mountAbsoluteInParent(host, anchor, shadow)
  }

  const handleOpen = () => {
    openPicker({
      anchor,
      triggerElement: host,
      field: opts.field,
      fieldUuid: opts.fieldUuid,
      fieldName: opts.fieldName,
      fieldType: opts.fieldType,
      section: opts.section,
      pickerMode: opts.pickerMode,
    })
  }

  const component = mount(PickerIcon, {
    target: mountTarget,
    props: {
      onOpen: handleOpen,
    },
  })

  return {
    destroy: () => {
      unmount(component)
      host.remove()
    },
    host,
  }
}
import { attachedFileNames, attachFile, hasDisplayedAncestor } from '~/core/fileAttach'
import { composedParent } from '~/core/shadowDom'
import { CV_FIELD_TYPE, isResumeFieldLabel } from '~/resolver/cvFile'
import type { CaptureRecord } from '~/field/baseField'
import type { ProfileValue } from '~/field/types'
import { GenericBaseField } from './GenericBaseField'
import { blockText, containsField, isRenderedElement, resolveLabel } from './labelResolver'

const GENERIC_FILE_LABEL = /^(files?|file[\s_-]*input|upload|upload( a)? files?|choose( a)? files?|select( a)? files?|attach( a)? files?|attach|browse|drop files? here)?$/i
const UPLOADER_CHROME = /(choose files?|no file (selected|chosen)|drag (and|&) drop|drop (your )?files?|browse|upload files?|attach files?|max(imum)? (file )?size|accepted file types|or drag)/i
const COVER_LETTER_LABEL = /\b(cover|motivation(al)?)\s*letter\b/i
const QUESTION_MAX_CHARS = 120
const QUESTION_MAX_DEPTH = 5
const ACTION_MAX_DEPTH = 3
const ACTION_MAX_CHARS = 60
const ACTION_SELECTOR = 'button, [role="button"]'
const OTHER_FIELD_SELECTOR = 'input:not([type="hidden"]), select, textarea, [role="combobox"], [role="textbox"]'
const DOCUMENT_ACTION = /\b(resume|cv|curriculum vitae|(cover|motivation(al)?)\s*letter)\b/i
const ACTION_VERBS = /^(?:(?:upload|attach|choose|select|browse|add|drop|import|your|my|a|an|the)\b[\s:-]*)+/i
const FILE_NAME = /[^\s/\\]+\.(pdf|docx?|rtf|txt|odt|pages)\b/i

const bare = (label: string): string => label.replace(/[*✱]/g, ' ').replace(/\s+/g, ' ').trim()

const nearestQuestion = (input: HTMLElement): string => {
  let node: HTMLElement | null = input
  for (let depth = 0; node && depth < QUESTION_MAX_DEPTH; depth++) {
    if (node.tagName === 'FORM' || node === document.body) return ''
    for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (!isRenderedElement(sib)) continue
      const text = blockText(sib)
      if (!text || UPLOADER_CHROME.test(text)) continue
      if (containsField(sib)) return ''
      if (text.length <= QUESTION_MAX_CHARS) return text
    }
    node = node.parentElement
  }
  return ''
}

const plain = (text: string): string => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')

const documentAction = (action: Element): string => {
  const text = bare(action.textContent ?? '')
  if (!text || text.length > ACTION_MAX_CHARS || FILE_NAME.test(text)) return ''
  const label = text.replace(ACTION_VERBS, '').trim()
  return DOCUMENT_ACTION.test(plain(label)) ? label : ''
}

const hasOtherField = (node: Element, input: HTMLElement): boolean =>
  Array.from(node.querySelectorAll(OTHER_FIELD_SELECTOR)).some((el) => el !== input)

const uploaderAction = (input: HTMLElement): string => {
  let node = composedParent(input)
  for (let depth = 0; node instanceof Element && depth < ACTION_MAX_DEPTH; depth++) {
    if (node.tagName === 'FORM' || node === document.body || hasOtherField(node, input)) return ''
    for (const action of Array.from(node.querySelectorAll(ACTION_SELECTOR))) {
      if (!isRenderedElement(action)) continue
      const label = documentAction(action)
      if (label) return label
    }
    node = composedParent(node)
  }
  return ''
}

export const fileQuestionLabel = (input: HTMLElement): string => {
  const own = resolveLabel(input)
  if (!GENERIC_FILE_LABEL.test(bare(own))) return own
  return nearestQuestion(input) || uploaderAction(input) || own
}

export const isDocumentQuestion = (label: string): boolean =>
  isResumeFieldLabel(label) || COVER_LETTER_LABEL.test(label)

export class GenericFileInput extends GenericBaseField {
  override fieldType = CV_FIELD_TYPE

  static SELECTOR = 'input[type="file"]'

  static qualifies(el: HTMLElement): boolean {
    if (!(el instanceof HTMLInputElement) || el.disabled) return false
    return hasDisplayedAncestor(el) && isDocumentQuestion(fileQuestionLabel(el))
  }

  get inputElement(): HTMLInputElement {
    return this.element as HTMLInputElement
  }

  override get fieldName(): string {
    return fileQuestionLabel(this.element)
  }

  override isDisplayed(): boolean {
    return hasDisplayedAncestor(this.element)
  }

  protected override getWidgetAnchor(): HTMLElement | null {
    return null
  }

  override collectCapture(): CaptureRecord | null {
    return null
  }

  currentValue(): string {
    return attachedFileNames(this.inputElement)
  }

  async fill(value: ProfileValue): Promise<boolean> {
    if (value.kind !== 'file') return false
    return attachFile(this.inputElement, value)
  }
}

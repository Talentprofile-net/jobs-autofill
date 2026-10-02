import type { ProfileValue } from '~/field/types'

export const CV_FIELD_TYPE = 'FileUpload'
export const CV_MIME_TYPE = 'application/pdf'
export const MAX_CV_BYTES = 10 * 1024 * 1024

export type CvFileValue = Extract<ProfileValue, { kind: 'file' }>

const RESUME_LABEL = /\b(resume|cv|curriculum vitae|lebenslauf)\b/i
const NOT_RESUME_LABEL = /\b(cover|motivation|transcript|portfolio|certificate|reference|photo|picture|avatar)\b|\bletter\s+of\s+(interest|intent)\b/i

export const isResumeFieldLabel = (label: string): boolean => {
  const text = label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!RESUME_LABEL.test(text)) return false
  return !NOT_RESUME_LABEL.test(text)
}

export const isPdfBytes = (bytes: Uint8Array): boolean =>
  bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46

export const cvFileName = (profileName: string | null | undefined): string => {
  const base = (profileName ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
  return base ? `${base}_CV.pdf` : 'CV.pdf'
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export const fromBase64 = (value: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export const toCvFileValue = (
  bytes: Uint8Array,
  profileName: string | null | undefined,
): CvFileValue | null => {
  if (bytes.length > MAX_CV_BYTES || !isPdfBytes(bytes)) return null
  return { base64: toBase64(bytes), kind: 'file', mimeType: CV_MIME_TYPE, name: cvFileName(profileName) }
}

export const acceptsPdf = (accept: string | null): boolean => {
  if (!accept || !accept.trim()) return true
  return accept
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .some((part) => part === '.pdf' || part === CV_MIME_TYPE || part === 'application/*' || part === '*/*')
}

const CV_FIELD_TYPES = new Set([CV_FIELD_TYPE, 'SingleFileUpload'])

export const isCvFileRequest = (field: { fieldName: string; fieldType: string }): boolean =>
  CV_FIELD_TYPES.has(field.fieldType) && isResumeFieldLabel(field.fieldName)

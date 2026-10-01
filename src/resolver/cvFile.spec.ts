import { describe, expect, it } from 'bun:test'

import {
  acceptsPdf,
  cvFileName,
  fromBase64,
  isCvFileRequest,
  isPdfBytes,
  isResumeFieldLabel,
  MAX_CV_BYTES,
  toCvFileValue,
} from './cvFile'

const pdf = new TextEncoder().encode('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n')

describe('isResumeFieldLabel', () => {
  for (const label of [
    'Resume/CV ✱ATTACH RESUME/CVCouldn\'t auto-read resume.Analyzing resume...',
    'Resume',
    'CV or resume *',
    'Upload your résumé',
    'Curriculum Vitae',
    'Lebenslauf',
    'Drop your file or upload, Upload resume',
  ]) {
    it(`accepts ${JSON.stringify(label.slice(0, 40))}`, () => {
      expect(isResumeFieldLabel(label)).toBe(true)
    })
  }

  for (const label of [
    'Cover letter',
    'Resume and cover letter',
    'Drop your file or upload, Additional files',
    'Portfolio (PDF)',
    'Transcript',
    'CVV',
    'Profile photo',
    '',
  ]) {
    it(`rejects ${JSON.stringify(label)}`, () => {
      expect(isResumeFieldLabel(label)).toBe(false)
    })
  }
})

describe('isCvFileRequest', () => {
  it('needs a file field type and a resume label', () => {
    expect(isCvFileRequest({ fieldName: 'Resume/CV', fieldType: 'FileUpload' })).toBe(true)
    expect(isCvFileRequest({ fieldName: 'Resume/CV', fieldType: 'SingleFileUpload' })).toBe(true)
    expect(isCvFileRequest({ fieldName: 'Resume/CV', fieldType: 'TextInput' })).toBe(false)
    expect(isCvFileRequest({ fieldName: 'Cover letter', fieldType: 'FileUpload' })).toBe(false)
  })
})

describe('toCvFileValue', () => {
  it('encodes a pdf under a name built from the profile name', () => {
    const value = toCvFileValue(pdf, 'Audit Tester')!
    expect([value.kind, value.mimeType, value.name]).toEqual(['file', 'application/pdf', 'Audit_Tester_CV.pdf'])
    expect(Array.from(fromBase64(value.base64))).toEqual(Array.from(pdf))
  })

  it('refuses bytes that are not a pdf', () => {
    expect(isPdfBytes(new TextEncoder().encode('<html>not found</html>'))).toBe(false)
    expect(toCvFileValue(new TextEncoder().encode('<html>not found</html>'), 'Audit Tester')).toBeNull()
  })

  it('refuses a pdf over the size cap', () => {
    const big = new Uint8Array(MAX_CV_BYTES + 1)
    big.set(pdf)
    expect(toCvFileValue(big, 'Audit Tester')).toBeNull()
  })
})

describe('cvFileName', () => {
  it('strips accents and unsafe characters', () => {
    expect(cvFileName('José  Müller-Ñúñez / QA')).toBe('Jose_Muller_Nunez_QA_CV.pdf')
  })

  it('falls back when there is no usable name', () => {
    expect(cvFileName(null)).toBe('CV.pdf')
    expect(cvFileName('  ///  ')).toBe('CV.pdf')
  })
})

describe('acceptsPdf', () => {
  it('accepts an input with no accept list or one that allows pdf', () => {
    expect(acceptsPdf(null)).toBe(true)
    expect(acceptsPdf('')).toBe(true)
    expect(acceptsPdf('.pdf,.doc,.docx')).toBe(true)
    expect(acceptsPdf('application/pdf')).toBe(true)
    expect(acceptsPdf('.DOC, .PDF')).toBe(true)
  })

  it('refuses an input that only takes other types', () => {
    expect(acceptsPdf('.doc,.docx')).toBe(false)
    expect(acceptsPdf('image/*')).toBe(false)
  })
})

import { describe, expect, it } from 'bun:test'

import { decideStandardField, isStandardField, normalizeNameOrId, type FieldEvidence } from './standardField'

const evidence = (over: Partial<FieldEvidence> = {}): FieldEvidence => ({
  autocomplete: '',
  control: 'text',
  id: '',
  inputType: 'text',
  labels: [],
  name: '',
  optionLabels: null,
  section: '',
  ...over,
})

const COUNTRIES = ['Select...', 'Germany', 'France', 'United States']

describe('standard field decision', () => {
  it.each([
    ['given-name', 'given-name'],
    ['family-name', 'family-name'],
    ['name', 'name'],
    ['email', 'email'],
    ['tel', 'tel'],
    ['tel-national', 'tel'],
    ['organization-title', 'organization-title'],
    ['address-level2', 'address-level2'],
    ['address-level1', 'address-level1'],
    ['country', 'country'],
    ['country-name', 'country'],
    ['  Given-Name ', 'given-name'],
  ])('maps autocomplete %p to %p', (autocomplete, field) => {
    expect(decideStandardField(evidence({ autocomplete }))).toEqual({ field })
  })

  it.each(['url', 'organization', 'street-address', 'address-line1', 'postal-code', 'additional-name', 'bday', 'sex', 'username', 'on', 'off', 'nonsense'])(
    'finds no evidence in autocomplete %p',
    (autocomplete) => {
      expect(decideStandardField(evidence({ autocomplete }))).toEqual({ refused: 'no-evidence' })
    },
  )

  it.each(['shipping email', 'billing given-name', 'section-ref email', 'work email', 'home tel', 'mobile tel', 'email webauthn'])(
    'refuses the qualified autocomplete %p',
    (autocomplete) => {
      expect(decideStandardField(evidence({ autocomplete }))).toEqual({ refused: 'qualified-autocomplete' })
    },
  )

  it.each([
    ['first_name', 'given-name'],
    ['firstName', 'given-name'],
    ['job_application[first_name]', 'given-name'],
    ['given-name', 'given-name'],
    ['last_name', 'family-name'],
    ['surname', 'family-name'],
    ['full_name', 'name'],
    ['email', 'email'],
    ['email_address', 'email'],
    ['phone', 'tel'],
    ['phone_number', 'tel'],
    ['urls[LinkedIn]', 'linkedin'],
    ['linkedin_url', 'linkedin'],
    ['github', 'github'],
    ['city', 'address-level2'],
    ['country', 'country'],
  ])('maps the exact name %p to %p', (name, field) => {
    expect(decideStandardField(evidence({ name }))).toEqual({ field })
    expect(decideStandardField(evidence({ id: name }))).toEqual({ field })
  })

  it.each(['name', 'first', 'fname_2', 'contact', 'portfolio', 'website', 'url', 'job_title', 'title', 'location', 'input-4', 'mail', 'urls[Portfolio]', 'emails'])(
    'finds no evidence in the ambiguous name %p',
    (name) => {
      expect(decideStandardField(evidence({ name, id: name }))).toEqual({ refused: 'no-evidence' })
    },
  )

  it('never resolves from a label, legend, ARIA text or input type alone', () => {
    expect(decideStandardField(evidence({ labels: ['First name'] }))).toEqual({ refused: 'no-evidence' })
    expect(decideStandardField(evidence({ inputType: 'email', labels: ['Email'] }))).toEqual({ refused: 'no-evidence' })
    expect(decideStandardField(evidence({ inputType: 'tel' }))).toEqual({ refused: 'no-evidence' })
  })

  it('accepts a label, legend or ARIA text that agrees with the attribute evidence', () => {
    expect(decideStandardField(evidence({ autocomplete: 'given-name', labels: ['First name *'] }))).toEqual({ field: 'given-name' })
    expect(decideStandardField(evidence({ labels: ['Email address (required)'], name: 'email' }))).toEqual({ field: 'email' })
    expect(decideStandardField(evidence({ autocomplete: 'tel', inputType: 'tel', labels: ['Phone number:'] }))).toEqual({ field: 'tel' })
  })

  it('refuses when attributes, labels or the input type disagree', () => {
    expect(decideStandardField(evidence({ autocomplete: 'given-name', name: 'last_name' }))).toEqual({ refused: 'conflict' })
    expect(decideStandardField(evidence({ id: 'first_name', name: 'email' }))).toEqual({ refused: 'conflict' })
    expect(decideStandardField(evidence({ autocomplete: 'given-name', labels: ['Last name'] }))).toEqual({ refused: 'conflict' })
    expect(decideStandardField(evidence({ autocomplete: 'given-name', inputType: 'email' }))).toEqual({ refused: 'conflict' })
    expect(decideStandardField(evidence({ autocomplete: 'email', inputType: 'tel' }))).toEqual({ refused: 'conflict' })
    expect(decideStandardField(evidence({ inputType: 'url', name: 'phone' }))).toEqual({ refused: 'conflict' })
  })

  it.each([
    ['consent', 'I consent to the processing of my email'],
    ['terms', 'I agree to the terms'],
    ['EEO', 'Gender'],
    ['EEO', 'Race / ethnicity'],
    ['EEO', 'Voluntary self-identification'],
    ['disability', 'Disability status'],
    ['veteran', 'Protected veteran status'],
    ['work authorization', 'Are you legally authorized to work in the country?'],
    ['sponsorship', 'Will you require visa sponsorship?'],
    ['export control', 'Export control country'],
    ['citizenship', 'Country of citizenship'],
    ['criminal', 'Have you ever been convicted of a criminal offense?'],
    ['background', 'Background check consent email'],
    ['salary', 'Expected salary'],
    ['availability', 'Availability'],
    ['notice period', 'Notice period'],
    ['start date', 'Earliest start date'],
  ])('refuses the sensitive %s field %p even with standard attributes', (_family, label) => {
    expect(decideStandardField(evidence({ autocomplete: 'country', control: 'text', labels: [label] }))).toEqual({ refused: 'sensitive' })
    expect(decideStandardField(evidence({ labels: [label], name: 'email' }))).toEqual({ refused: 'sensitive' })
  })

  it('refuses sensitive names and ids', () => {
    expect(decideStandardField(evidence({ autocomplete: 'country', name: 'citizenship_country' }))).toEqual({ refused: 'sensitive' })
    expect(decideStandardField(evidence({ autocomplete: 'tel', id: 'emergency_phone' }))).toEqual({ refused: 'sensitive' })
  })

  it.each(['Referrer email', 'Emergency contact phone', 'Reference full name', "Manager's email", 'Company name', 'University city'])(
    'refuses %p as describing someone or something other than the applicant',
    (label) => {
      expect(decideStandardField(evidence({ autocomplete: 'email', labels: [label] }))).toEqual({ refused: 'sensitive' })
    },
  )

  it('uses select and radio option structure only for place fields', () => {
    expect(decideStandardField(evidence({ autocomplete: 'country', control: 'select', optionLabels: COUNTRIES }))).toEqual({ field: 'country' })
    expect(decideStandardField(evidence({ control: 'select', name: 'city', optionLabels: ['Berlin', 'Paris', 'Austin'] }))).toEqual({ field: 'address-level2' })
    expect(decideStandardField(evidence({ autocomplete: 'country', control: 'select', optionLabels: ['Yes', 'No', 'Maybe'] }))).toEqual({ refused: 'control' })
    expect(decideStandardField(evidence({ autocomplete: 'country', control: 'select', optionLabels: ['Germany', 'France'] }))).toEqual({ refused: 'control' })
    expect(decideStandardField(evidence({ autocomplete: 'country', control: 'select', optionLabels: null }))).toEqual({ refused: 'control' })
    expect(decideStandardField(evidence({ autocomplete: 'email', control: 'select', optionLabels: COUNTRIES }))).toEqual({ refused: 'control' })
    expect(decideStandardField(evidence({ autocomplete: 'country', control: 'choice', optionLabels: COUNTRIES }))).toEqual({ refused: 'control' })
    expect(decideStandardField(evidence({ control: 'textarea', name: 'email' }))).toEqual({ refused: 'control' })
    expect(decideStandardField(evidence({ control: 'other', name: 'email' }))).toEqual({ refused: 'control' })
  })

  it('refuses a field inside an education or employment entry', () => {
    expect(decideStandardField(evidence({ autocomplete: 'organization-title', section: 'employment 2' }))).toEqual({ refused: 'section' })
    expect(decideStandardField(evidence({ name: 'city', section: 'education 1' }))).toEqual({ refused: 'section' })
    expect(decideStandardField(evidence({ autocomplete: 'organization-title', section: 'personal' }))).toEqual({ field: 'organization-title' })
  })

  it('normalizes names and ids exactly, without partial matching', () => {
    expect(normalizeNameOrId(' Job_Application[First-Name] ')).toBe('first_name')
    expect(normalizeNameOrId('__email__')).toBe('email')
    expect(normalizeNameOrId('candidate.email.address')).toBe('candidate_email_address')
    expect(decideStandardField(evidence({ name: 'candidate.email.address' }))).toEqual({ refused: 'no-evidence' })
  })

  it('recognizes only listed standard fields', () => {
    expect(isStandardField('email')).toBe(true)
    expect(isStandardField('url')).toBe(false)
    expect(isStandardField(1)).toBe(false)
    expect(isStandardField(null)).toBe(false)
  })
})

import { describe, expect, it } from 'bun:test'

import { decideStandardField, isStandardField, normalizeNameOrId, type FieldEvidence, type StandardField } from './standardField'

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
    expect(decideStandardField(evidence({ labels: ['Phone'] }))).toEqual({ refused: 'no-evidence' })
    expect(decideStandardField(evidence({ inputType: 'tel' }))).toEqual({ refused: 'no-evidence' })
    expect(decideStandardField(evidence({ inputType: 'email' }))).toEqual({ refused: 'no-evidence' })
  })

  it.each<[string, string[], StandardField]>([
    ['tel', ['Phone'], 'tel'],
    ['tel', ['Phone number *', 'Phone'], 'tel'],
    ['email', ['Email'], 'email'],
    ['email', ['Email address (required)'], 'email'],
    ['url', ['LinkedIn'], 'linkedin'],
    ['url', ['GitHub'], 'github'],
  ])('resolves a native %p input whose every label is the exact matching field', (inputType, labels, field) => {
    expect(decideStandardField(evidence({ inputType, labels }))).toEqual({ field })
  })

  it.each<[string, string[], string]>([
    ['text', ['Phone'], ''],
    ['search', ['Phone'], ''],
    ['', ['Email'], ''],
    ['tel', ['Email'], ''],
    ['email', ['Phone'], ''],
    ['tel', ['Phone', 'Preferred contact time'], ''],
    ['tel', ['Phone', 'Email'], ''],
    ['email', ['Work email'], ''],
    ['tel', ['Phone'], 'Emergency contact'],
    ['email', ['Email'], 'Reference 1'],
  ])('finds no evidence in a native %p input labelled %p in section %p', (inputType, labels, section) => {
    expect(decideStandardField(evidence({ inputType, labels, section }))).toEqual({ refused: 'no-evidence' })
  })

  it('keeps refusal rules when a native input carries an exact label', () => {
    expect(decideStandardField(evidence({ inputType: 'tel', labels: ['Emergency contact phone'] }))).toEqual({ refused: 'sensitive' })
    expect(decideStandardField(evidence({ inputType: 'email', labels: ['Referrer email'] }))).toEqual({ refused: 'sensitive' })
    expect(decideStandardField(evidence({ inputType: 'email', labels: ['Email'], section: 'employment 1' }))).toEqual({ refused: 'section' })
    expect(decideStandardField(evidence({ autocomplete: 'email', inputType: 'tel', labels: ['Phone'] }))).toEqual({ refused: 'conflict' })
    expect(decideStandardField(evidence({ inputType: 'tel', labels: ['Phone'], name: 'first_name' }))).toEqual({ refused: 'conflict' })
  })

  it.each([
    ['legalName--firstName', 'given-name'],
    ['legalName--lastName', 'family-name'],
    ['name--legalName--firstName', 'given-name'],
    ['name--legalName--lastName', 'family-name'],
    ['legal_name--first_name', 'given-name'],
  ])('maps the applicant name path %p to %p', (name, field) => {
    expect(decideStandardField(evidence({ name }))).toEqual({ field })
    expect(decideStandardField(evidence({ id: name }))).toEqual({ field })
    expect(decideStandardField(evidence({ id: `name--${name}`, labels: ['Given Name - Western Script'], name }))).toEqual({ field })
  })

  it('refuses an applicant name path that disagrees with the rest of the evidence', () => {
    expect(decideStandardField(evidence({ labels: ['Last name'], name: 'legalName--firstName' }))).toEqual({ refused: 'conflict' })
    expect(decideStandardField(evidence({ id: 'name--legalName--lastName', name: 'legalName--firstName' }))).toEqual({ refused: 'conflict' })
    expect(decideStandardField(evidence({ autocomplete: 'email', name: 'legalName--firstName' }))).toEqual({ refused: 'conflict' })
    expect(decideStandardField(evidence({ inputType: 'email', name: 'legalName--firstName' }))).toEqual({ refused: 'conflict' })
    expect(decideStandardField(evidence({ labels: ['Referrer first name'], name: 'legalName--firstName' }))).toEqual({ refused: 'sensitive' })
    expect(decideStandardField(evidence({ name: 'legalName--firstName', section: 'employment 1' }))).toEqual({ refused: 'section' })
  })

  it.each([
    'legalName--firstNameLocal',
    'legalName--lastNameLocal',
    'legalName--middleName',
    'preferredName--firstName',
    'emergencyContact--firstName',
    'reference--lastName',
    'spouse--name--firstName',
    'legalName--email',
    'legalName--',
    'legalName---firstName',
    'legalName-firstName',
    'legalName__firstName',
  ])('resolves nothing from the path %p', (name) => {
    expect('refused' in decideStandardField(evidence({ name, id: name }))).toBe(true)
    expect('refused' in decideStandardField(evidence({ labels: ['First name'], name }))).toBe(true)
  })

  it.each([
    ['_systemfield_name', 'name'],
    ['_systemfield_email', 'email'],
    [' _SystemField_Email ', 'email'],
  ])('maps the exact system token %p to %p', (name, field) => {
    expect(decideStandardField(evidence({ name }))).toEqual({ field })
    expect(decideStandardField(evidence({ id: name }))).toEqual({ field })
    expect(decideStandardField(evidence({ id: name, name }))).toEqual({ field })
  })

  it('refuses a system token that disagrees with the rest of the evidence', () => {
    expect(decideStandardField(evidence({ labels: ['Email'], name: '_systemfield_name' }))).toEqual({ refused: 'conflict' })
    expect(decideStandardField(evidence({ inputType: 'tel', name: '_systemfield_email' }))).toEqual({ refused: 'conflict' })
    expect(decideStandardField(evidence({ id: 'email', name: '_systemfield_name' }))).toEqual({ refused: 'conflict' })
    expect(decideStandardField(evidence({ labels: ['Referrer name (if relevant)'], name: '_systemfield_name' }))).toEqual({ refused: 'sensitive' })
    expect(decideStandardField(evidence({ control: 'textarea', name: '_systemfield_name' }))).toEqual({ refused: 'control' })
  })

  it.each([
    '_systemfield_resume',
    '_systemfield_location',
    '_systemfield_eeoc_gender',
    '7fcba0c3-c874-4ee1-81ea-5dd3331e4f15__systemfield_eeoc_gender',
    'x_systemfield_name',
    '_systemfield_name_2',
    '_systemfield_names',
    'systemfield_name',
    '__systemfield_name',
  ])('resolves nothing from the system token %p', (name) => {
    expect('refused' in decideStandardField(evidence({ name, id: name }))).toBe(true)
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

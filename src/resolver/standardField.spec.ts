import { describe, expect, it } from 'bun:test'

import { decideStandardField, isStandardField, normalizeNameOrId, type FieldEvidence, type StandardField } from './standardField'

const evidence = (over: Partial<FieldEvidence> = {}): FieldEvidence => ({
  autocomplete: '',
  combobox: false,
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
    const label = field === 'given-name' ? 'Given Name - Western Script' : 'Family Name - Western Script'
    expect(decideStandardField(evidence({ id: `name--${name}`, labels: [label], name }))).toEqual({ field })
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

  it.each<[string, Partial<FieldEvidence>]>([
    ['Thai Given Name', { name: 'first_name' }],
    ['Thai Family Name', { autocomplete: 'family-name' }],
  ])('refuses the local-script name label %p with %p', (label, over) => {
    expect('refused' in decideStandardField(evidence({ labels: [label], ...over }))).toBe(true)
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

  it.each<[string[], boolean, StandardField]>([
    [['Country of Residence'], false, 'country'],
    [['What is your current country of residence?*'], true, 'country'],
    [['Current country of residence', 'Country of residence'], false, 'country'],
    [['City *'], false, 'address-level2'],
    [['City', 'City *'], false, 'address-level2'],
  ])('resolves the applicant place label %p on a text control (combobox %p)', (labels, combobox, field) => {
    expect(decideStandardField(evidence({ combobox, labels }))).toEqual({ field })
    expect(decideStandardField(evidence({ combobox, inputType: '', labels }))).toEqual({ field })
  })

  it.each<[string[], Partial<FieldEvidence>]>([
    [['Country'], {}],
    [['Country*'], { combobox: true }],
    [['City'], { combobox: true }],
    [['Location (City)*'], { combobox: true }],
    [['Location (City)'], {}],
    [['What is your location?'], {}],
    [['Current location'], {}],
    [['City', 'Current location'], {}],
    [['City', 'Country of residence'], {}],
    [['City'], { inputType: 'email' }],
    [['City'], { control: 'select', optionLabels: ['Berlin', 'Paris', 'Austin'] }],
    [['Country of residence'], { control: 'select', optionLabels: ['Germany', 'France', 'Spain'] }],
    [['Country of residence'], { control: 'textarea' }],
    [['City'], { section: 'Emergency contact' }],
    [['Country of residence'], { section: 'Demographic Survey' }],
  ])('refuses the place label %p with %p', (labels, over) => {
    expect('refused' in decideStandardField(evidence({ labels, ...over }))).toBe(true)
  })

  it('refuses an async city combobox even when name or autocomplete says city', () => {
    expect('refused' in decideStandardField(evidence({ combobox: true, labels: ['City'], name: 'city' }))).toBe(true)
    expect('refused' in decideStandardField(evidence({ autocomplete: 'address-level2', combobox: true, labels: ['City'] }))).toBe(true)
  })

  it.each([
    'Passport Country',
    'Country of birth',
    'City of birth',
    'Country of citizenship',
    'Nationality',
    'Are you willing to relocate?',
    'Work authorization country',
    'Visa country',
    'Company city',
    'University city',
  ])('refuses the sensitive or third-party place question %p', (label) => {
    expect('refused' in decideStandardField(evidence({ labels: [label] }))).toBe(true)
    expect('refused' in decideStandardField(evidence({ autocomplete: 'country', labels: [label] }))).toBe(true)
  })

  it('refuses a place label that disagrees with the attribute evidence or sits in an entry section', () => {
    expect(decideStandardField(evidence({ id: 'country', labels: ['Country', 'Phone'] }))).toEqual({ refused: 'conflict' })
    expect(decideStandardField(evidence({ id: 'country', labels: ['City'] }))).toEqual({ refused: 'conflict' })
    expect(decideStandardField(evidence({ autocomplete: 'address-level2', labels: ['Country of residence'] }))).toEqual({ refused: 'conflict' })
    expect(decideStandardField(evidence({ labels: ['City'], section: 'employment 1' }))).toEqual({ refused: 'section' })
    expect(decideStandardField(evidence({ labels: ['Passport Country'], name: 'country' }))).toEqual({ refused: 'sensitive' })
    expect(decideStandardField(evidence({ labels: ['Demographic survey: country of residence'] }))).toEqual({ refused: 'sensitive' })
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

describe('alternate identity fields', () => {
  it.each<[string, Partial<FieldEvidence>]>([
    ['Preferred First Name', { name: '_systemfield_name' }],
    ['Preferred First & Last Name', { id: '_systemfield_name', name: '_systemfield_name' }],
    ['Legal Name (if different than above)', { name: 'full_name' }],
    ['Preferred name', { autocomplete: 'given-name' }],
    ['Nickname', { autocomplete: 'name' }],
    ['Alias', { name: 'full_name' }],
    ['Full legal name, if different from your preferred name', { name: 'full_name' }],
    ['Maiden name', { autocomplete: 'family-name' }],
    ['Name you go by', { name: 'first_name' }],
  ])('refuses %p even with standard attributes %p', (label, over) => {
    expect(decideStandardField(evidence({ labels: [label], ...over }))).toEqual({ refused: 'alternate-identity' })
    expect(decideStandardField(evidence({ inputType: 'email', labels: [label], ...over }))).toEqual({ refused: 'alternate-identity' })
  })

  it.each<[string, Partial<FieldEvidence>]>([
    ['Chosen name', { name: '_systemfield_name' }],
    ['What should we call you?', { name: 'first_name' }],
    ['Name you would like us to use', { autocomplete: 'name' }],
  ])('refuses the chosen-name wording %p even with standard attributes %p', (label, over) => {
    expect(decideStandardField(evidence({ labels: [label], ...over }))).toEqual({ refused: 'alternate-identity' })
  })

  it.each<[string, Partial<FieldEvidence>, StandardField]>([
    ['Legal First Name', { name: 'first_name' }, 'given-name'],
    ['Legal Last Name', { name: 'last_name' }, 'family-name'],
    ['Legal name', { name: '_systemfield_name' }, 'name'],
    ['First name', { autocomplete: 'given-name' }, 'given-name'],
    ['Last name', { autocomplete: 'family-name' }, 'family-name'],
    ['Full name', { name: 'full_name' }, 'name'],
    ['Name', { name: '_systemfield_name' }, 'name'],
  ])('keeps the applicant name field %p', (label, over, field) => {
    expect(decideStandardField(evidence({ labels: [label], ...over }))).toEqual({ field })
  })
})

describe('name pronunciation fields', () => {
  it.each<[string, Partial<FieldEvidence>]>([
    ['How do you pronounce your name?', { autocomplete: 'name' }],
    ['Name pronunciation', { autocomplete: 'name' }],
    ['Phonetic spelling of your name', { name: 'full_name' }],
    ['How should we say your name?', { id: 'fullname' }],
    ['How do you pronounce your name?', { name: '_systemfield_name' }],
    ['Name pronunciation', { id: '_systemfield_name', name: '_systemfield_name' }],
    ['How do you pronounce your name?', { name: 'name' }],
    ['How do you pronounce your name?', { autocomplete: 'given-name', name: 'first_name' }],
  ])('refuses %p even with standard attributes %p', (label, over) => {
    expect(decideStandardField(evidence({ labels: [label], ...over }))).toEqual({ refused: 'name-pronunciation' })
  })

  it('refuses a pronunciation control named by its attributes alone', () => {
    expect(decideStandardField(evidence({ autocomplete: 'name', name: 'name_pronunciation' }))).toEqual({ refused: 'name-pronunciation' })
  })

  it.each<[string, Partial<FieldEvidence>, StandardField]>([
    ['Full name', { autocomplete: 'name' }, 'name'],
    ['Legal name', { name: '_systemfield_name' }, 'name'],
    ['Name', { name: 'full_name' }, 'name'],
  ])('keeps the full name field %p', (label, over, field) => {
    expect(decideStandardField(evidence({ labels: [label], ...over }))).toEqual({ field })
  })

  it('does not treat preferred pronouns as pronunciation', () => {
    expect(decideStandardField(evidence({ autocomplete: 'name', labels: ['Preferred pronouns'] }))).toEqual({ refused: 'sensitive' })
  })
})

describe('reviewed exact applicant labels', () => {
  it.each<[string[], StandardField]>([
    [['Legal First Name'], 'given-name'],
    [['Legal Last Name'], 'family-name'],
    [['Current City*'], 'address-level2'],
    [['Where do you live? (City) *'], 'address-level2'],
    [['Current Title*'], 'organization-title'],
    [['Current/Most Recent Job Title'], 'organization-title'],
    [['What country are you based in?'], 'country'],
    [['What country do you currently live in?'], 'country'],
    [['Legal First Name', 'Legal First Name'], 'given-name'],
  ])('resolves %p on a plain text control', (labels, field) => {
    expect(decideStandardField(evidence({ labels }))).toEqual({ field })
    expect(decideStandardField(evidence({ inputType: '', labels }))).toEqual({ field })
  })

  it.each<[string[], Partial<FieldEvidence>]>([
    [['Legal First Name'], { combobox: true }],
    [['Current City'], { combobox: true }],
    [['Current Title'], { combobox: true }],
    [['Legal First Name'], { control: 'textarea' }],
    [['Current Title'], { control: 'select', optionLabels: ['Engineer', 'Manager', 'Designer'] }],
    [['Legal First Name'], { inputType: 'email' }],
    [['Legal First Name'], { section: 'employment 1' }],
    [['Current Title'], { section: 'employment 1' }],
    [['Current City'], { section: 'Emergency contact' }],
    [['Legal First Name', 'Legal Last Name'], {}],
    [['Legal First Name'], { name: 'last_name' }],
    [['Current City'], { autocomplete: 'country' }],
    [['Legal First Name', 'Contact'], {}],
    [['Previous job title'], {}],
    [['Most recent employer'], {}],
    [['City of birth'], {}],
    [['What country are you a citizen of?'], {}],
    [['Which country would you relocate to?'], {}],
    [['Emergency contact legal first name'], {}],
    [['Reference current title'], {}],
  ])('refuses %p with %p', (labels, over) => {
    expect('refused' in decideStandardField(evidence({ labels, ...over }))).toBe(true)
  })
})

describe('worded name tokens and wording conflicts', () => {
  it('maps the bare name token only with full-name wording', () => {
    expect(decideStandardField(evidence({ labels: ['What is your full name?'], name: 'name' }))).toEqual({ field: 'name' })
    expect(decideStandardField(evidence({ id: 'name', labels: ['Full name *'] }))).toEqual({ field: 'name' })
    expect(decideStandardField(evidence({ name: 'name' }))).toEqual({ refused: 'no-evidence' })
    expect(decideStandardField(evidence({ labels: ['Name'], name: 'name' }))).toEqual({ refused: 'no-evidence' })
    expect(decideStandardField(evidence({ labels: ['What is your first name?'], name: 'name' }))).toEqual({ refused: 'no-evidence' })
    expect(decideStandardField(evidence({ labels: ['Company name'], name: 'name' }))).toEqual({ refused: 'sensitive' })
    expect(decideStandardField(evidence({ labels: ['Full name or email'], name: 'name' }))).toEqual({ refused: 'no-evidence' })
  })

  it('reads combined first and last name wording as the full name', () => {
    for (const label of ['First and Last Name', 'Legal First and Last Name', 'First & Last Name', 'First/Last name']) {
      expect(decideStandardField(evidence({ labels: [label], name: '_systemfield_name' }))).toEqual({ field: 'name' })
      expect(decideStandardField(evidence({ labels: [label], name: 'name' }))).toEqual({ field: 'name' })
    }
    expect(decideStandardField(evidence({ labels: ['First and Last Name'], name: 'first_name' }))).toEqual({ refused: 'conflict' })
  })

  it('resolves an exact name token whose unassociated wording agrees', () => {
    expect(decideStandardField(evidence({ inputType: 'email', labels: ['What is your email?'], name: 'email' }))).toEqual({ field: 'email' })
    expect(decideStandardField(evidence({ inputType: '', labels: ['What is your phone number?'], name: 'phone' }))).toEqual({ field: 'tel' })
    expect(decideStandardField(evidence({ inputType: '', labels: ['Phone (include country code)'], name: 'phone' }))).toEqual({ field: 'tel' })
  })

  it('refuses a token or autocomplete whose wording names a different field', () => {
    expect(decideStandardField(evidence({ labels: ['What is your phone number?'], name: 'email' }))).toEqual({ refused: 'conflict' })
    expect(decideStandardField(evidence({ labels: ['Email address'], name: 'phone' }))).toEqual({ refused: 'conflict' })
    expect(decideStandardField(evidence({ labels: ['Legal First Name'], name: '_systemfield_name' }))).toEqual({ refused: 'conflict' })
    expect(decideStandardField(evidence({ autocomplete: 'email', labels: ['Your mobile'] }))).toEqual({ refused: 'conflict' })
    expect(decideStandardField(evidence({ labels: ['What country do you live in?'], name: 'city' }))).toEqual({ refused: 'conflict' })
    expect(decideStandardField(evidence({ labels: ['Given Name - Western Script'], name: 'legalName--lastName' }))).toEqual({ refused: 'conflict' })
  })
})

describe('another person', () => {
  it.each<[string, Partial<FieldEvidence>]>([
    ['Spouse full name', { name: 'full_name' }],
    ['Referrer email', { inputType: 'email', name: 'email' }],
    ['Emergency contact phone', { inputType: 'tel', name: 'phone' }],
    ['Emergency contact city', { name: 'city' }],
    ['Reference country', { autocomplete: 'country' }],
    ['Referrer LinkedIn profile', { inputType: 'url' }],
    ['Reference GitHub URL', { name: 'github' }],
    ["Your manager's LinkedIn URL", {}],
  ])('refuses %p with %p', (label, over) => {
    expect(decideStandardField(evidence({ labels: [label], ...over }))).toEqual({ refused: 'sensitive' })
  })

  it.each<[string, Partial<FieldEvidence>]>([
    ["Your friend's email", { inputType: 'email', name: 'email' }],
    ["Colleague's full name", { name: 'full_name' }],
    ["Co-founder's email", { autocomplete: 'email' }],
  ])('refuses the possessive label %p with %p', (label, over) => {
    expect('refused' in decideStandardField(evidence({ labels: [label], ...over }))).toBe(true)
  })
})

describe('provider link questions', () => {
  it.each<[string, Partial<FieldEvidence>, StandardField]>([
    ['If you have a portfolio, GitHub, or other project showcases, please share a link below.', {}, 'github'],
    ['Portfolio / Github URL', {}, 'github'],
    ['Please insert link to your LinkedIn, portfolio or equivalent*', { control: 'textarea', inputType: '' }, 'linkedin'],
    ['Would you like to include your LinkedIn profile, personal website or blog?', {}, 'linkedin'],
    ['LinkedIn Profile', {}, 'linkedin'],
    ["What's your GitHub profile?", { inputType: 'url' }, 'github'],
  ])('maps %p with exactly one provider', (label, over, field) => {
    expect(decideStandardField(evidence({ labels: [label], ...over }))).toEqual({ field })
  })

  it.each<[string, Partial<FieldEvidence>]>([
    ['LinkedIn or GitHub profile URL', {}],
    ['LinkedIn/GitHub/portfolio link', {}],
    ['LinkedIn/GitHub/portfolio link', { control: 'textarea', inputType: '' }],
    ['Portfolio link', {}],
    ['Personal website URL', {}],
    ['Website', { inputType: 'url' }],
    ["Your referrer's LinkedIn profile", {}],
    ["Your co-founder's GitHub URL", {}],
    ['LinkedIn profile of the person who referred you', {}],
    ['Manager LinkedIn URL', {}],
    ['LinkedIn', {}],
    ['How did you hear about us? (LinkedIn, Indeed, other)', {}],
    ['Share 2–3 of your open-source contributions with links (GitHub PRs, issues, or projects you maintain)', { control: 'textarea', inputType: '' }],
    ['GitHub profiles of your projects', {}],
    [`Tell us about a project you are proud of, what you built, who you built it with, what was hard about it, and share a link to its GitHub page`, { control: 'textarea', inputType: '' }],
    ['LinkedIn profile', { combobox: true }],
    ['LinkedIn profile', { control: 'select', optionLabels: ['Yes', 'No', 'Maybe'] }],
    ['LinkedIn profile', { inputType: 'email' }],
    ['LinkedIn profile', { section: 'employment 1' }],
    ['LinkedIn profile', { name: 'github' }],
  ])('refuses %p with %p', (label, over) => {
    expect('refused' in decideStandardField(evidence({ labels: [label], ...over }))).toBe(true)
  })

  it('needs every label to name the same single provider', () => {
    expect('refused' in decideStandardField(evidence({ labels: ['GitHub URL', 'LinkedIn URL'] }))).toBe(true)
    expect('refused' in decideStandardField(evidence({ labels: ['GitHub URL', 'Links'] }))).toBe(true)
  })

  it('keeps refusing a textarea for every other field', () => {
    expect(decideStandardField(evidence({ control: 'textarea', inputType: '', labels: ['Email'], name: 'email' }))).toEqual({ refused: 'control' })
    expect(decideStandardField(evidence({ control: 'textarea', inputType: '', labels: ['Current City'] }))).toEqual({ refused: 'no-evidence' })
  })

  it('maps a single-provider link question that asks only if available', () => {
    expect(decideStandardField(evidence({ control: 'textarea', inputType: '', labels: ['LinkedIn Profile, if available'] }))).toEqual({ field: 'linkedin' })
  })
})

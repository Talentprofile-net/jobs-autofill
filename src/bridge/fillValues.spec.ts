import { describe, expect, it } from 'bun:test'

import { fieldsWithoutProfileValue, mergeFillValues } from './fillValues'

const field = (requestId: string) => ({ fieldName: requestId, fieldType: 'TextInput', requestId, section: '' })
const email = { confidence: 'exact' as const, kind: 'string' as const, value: 'me@example.invalid' }
const answer = { confidence: 'exact' as const, kind: 'string' as const, value: 'Saved answer' }

describe('fill value merge', () => {
  const fields = [field('email'), field('saved'), field('none')]
  const profile = [
    { profileField: 'email', requestId: 'email', value: email },
    { profileField: null, requestId: 'saved', value: { kind: 'unsupported' as const } },
  ]

  it('asks saved answers only for fields the profile could not fill', () => {
    expect(fieldsWithoutProfileValue(fields, profile).map((f) => f.requestId)).toEqual(['saved', 'none'])
  })

  it('prefers the profile value, then a saved answer, then unsupported', () => {
    const learned = [
      { matchedAnswerId: 'answer-1', requestId: 'saved', value: answer },
      { matchedAnswerId: null, requestId: 'none', value: { kind: 'unsupported' as const } },
    ]

    expect(mergeFillValues(fields, profile, learned)).toEqual([
      { matchedAnswerId: null, profileField: 'email', requestId: 'email', value: email },
      { matchedAnswerId: 'answer-1', profileField: null, requestId: 'saved', value: answer },
      { matchedAnswerId: null, profileField: null, requestId: 'none', value: { kind: 'unsupported' } },
    ])
  })

  it('never lets a timed-out saved-answer lookup replace the profile result', () => {
    const learned = [{ matchedAnswerId: null, requestId: 'saved', value: { kind: 'timeout' as const } }]

    expect(mergeFillValues([field('saved')], profile, learned)[0].value).toEqual({ kind: 'unsupported' })
  })
})

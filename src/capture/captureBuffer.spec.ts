import { afterEach, describe, expect, it } from 'bun:test'

import {
  registerFieldForCapture,
  teardownAllCaptureForms,
  unregisterFieldFromCapture,
} from './captureBuffer'

const harness = () => {
  const formAdds: Array<[string, EventListenerOrEventListenerObject]> = []
  const formRemoves: Array<[string, EventListenerOrEventListenerObject]> = []
  const documentAdds: Array<[
    string,
    EventListenerOrEventListenerObject,
    boolean | AddEventListenerOptions | undefined,
  ]> = []
  const documentRemoves: Array<[
    string,
    EventListenerOrEventListenerObject,
    boolean | EventListenerOptions | undefined,
  ]> = []

  const form = {
    addEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject,
    ) => formAdds.push([type, listener]),
    contains: () => true,
    removeEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject,
    ) => formRemoves.push([type, listener]),
  } as never
  const field = {
    element: { closest: () => form },
  } as never

  globalThis.document = {
    addEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => documentAdds.push([type, listener, options]),
    removeEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) => documentRemoves.push([type, listener, options]),
  } as never

  return { documentAdds, documentRemoves, field, formAdds, formRemoves }
}

afterEach(() => {
  teardownAllCaptureForms()
})

describe('capture listener lifecycle', () => {
  it('removes the exact registered listeners when the final field unregisters', () => {
    const h = harness()

    registerFieldForCapture(h.field)
    unregisterFieldFromCapture(h.field)

    expect(h.formAdds).toHaveLength(1)
    expect(h.formRemoves).toEqual(h.formAdds)
    expect(h.documentAdds).toHaveLength(1)
    expect(h.documentRemoves).toEqual(h.documentAdds)
  })

  it('teardown removes listeners and a later scan attaches only one fresh pair', () => {
    const h = harness()

    registerFieldForCapture(h.field)
    registerFieldForCapture(h.field)
    expect(h.formAdds).toHaveLength(1)
    expect(h.documentAdds).toHaveLength(1)

    teardownAllCaptureForms()
    expect(h.formRemoves).toHaveLength(1)
    expect(h.documentRemoves).toHaveLength(1)

    registerFieldForCapture(h.field)
    expect(h.formAdds).toHaveLength(2)
    expect(h.documentAdds).toHaveLength(2)
  })
})

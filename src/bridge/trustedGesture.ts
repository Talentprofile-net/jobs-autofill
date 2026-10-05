import { findEnclosingForm, submitButtonFor } from '~/capture/submitTarget'

export type GestureKind = 'click' | 'edit' | 'submit'

export type Gesture = {
  at: number
  element: HTMLElement | null
  form: HTMLElement | null
  kind: GestureKind
}

const WINDOW_MS: Record<GestureKind, number> = {
  click: 2_000,
  edit: 10_000,
  submit: 3_000,
}

const firstElement = (event: Event): HTMLElement | null => {
  const node = event.composedPath()[0]
  return node instanceof HTMLElement ? node : null
}

export const createGestureTracker = (target: Window, now: () => number = Date.now) => {
  const latest = new Map<GestureKind, Gesture>()

  const onClick = (event: MouseEvent): void => {
    if (!event.isTrusted) return
    const origin = firstElement(event)
    const anchor = event.target instanceof HTMLElement ? event.target : origin
    latest.set('click', { at: now(), element: anchor, form: null, kind: 'click' })
    const button = origin ? submitButtonFor(origin) : null
    if (button) latest.set('submit', { at: now(), element: button, form: findEnclosingForm(button), kind: 'submit' })
  }

  const onSubmit = (event: Event): void => {
    if (!event.isTrusted || !(event.target instanceof HTMLElement)) return
    latest.set('submit', { at: now(), element: event.target, form: event.target, kind: 'submit' })
  }

  const onChange = (event: Event): void => {
    if (!event.isTrusted) return
    const element = firstElement(event)
    latest.set('edit', { at: now(), element, form: element ? findEnclosingForm(element) : null, kind: 'edit' })
  }

  target.addEventListener('click', onClick, true)
  target.addEventListener('submit', onSubmit, true)
  target.addEventListener('change', onChange, true)

  return {
    consume: (kind: GestureKind): Gesture | null => {
      const gesture = latest.get(kind)
      latest.delete(kind)
      if (!gesture || now() - gesture.at > WINDOW_MS[kind]) return null
      return gesture
    },
    destroy: (): void => {
      target.removeEventListener('click', onClick, true)
      target.removeEventListener('submit', onSubmit, true)
      target.removeEventListener('change', onChange, true)
    },
  }
}

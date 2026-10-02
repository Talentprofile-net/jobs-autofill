type VisibilitySource = {
  readonly visibilityState: DocumentVisibilityState
  addEventListener(type: 'visibilitychange', listener: () => void): void
  removeEventListener(type: 'visibilitychange', listener: () => void): void
}

const pending = new WeakMap<VisibilitySource, Promise<void>>()

export const whenDocumentVisible = (doc: VisibilitySource = document): Promise<void> => {
  if (doc.visibilityState !== 'hidden') return Promise.resolve()
  const existing = pending.get(doc)
  if (existing) return existing
  const waiting = new Promise<void>((resolve) => {
    const onChange = () => {
      if (doc.visibilityState === 'hidden') return
      doc.removeEventListener('visibilitychange', onChange)
      pending.delete(doc)
      resolve()
    }
    doc.addEventListener('visibilitychange', onChange)
  })
  pending.set(doc, waiting)
  return waiting
}

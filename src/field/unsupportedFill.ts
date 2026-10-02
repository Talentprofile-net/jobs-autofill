export class UnsupportedFillError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'UnsupportedFillError'
  }
}

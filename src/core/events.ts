export const createKeyboardEvent = (
  type: 'keydown' | 'keyup' | 'keypress',
  key: string,
): KeyboardEvent =>
  new KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    key,
  })
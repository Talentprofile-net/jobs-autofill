const propsKeyCache = new WeakMap<HTMLElement, string>()

export const getReactProps = (element: HTMLElement): any => {
  const cached = propsKeyCache.get(element)
  if (cached !== undefined) {
    const props = (element as any)[cached]
    if (props !== undefined) return props
    propsKeyCache.delete(element)
  }
  for (const key in element) {
    if (key.startsWith('__reactProps')) {
      propsKeyCache.set(element, key)
      return (element as any)[key]
    }
  }
  return undefined
}

export const setNativeInputValue = (
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void => {
  const proto =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
  if (descriptor?.set) {
    descriptor.set.call(input, value)
  } else {
    input.value = value
  }
}

type TextFillEvent = 'onChange' | 'onBlur'
type FillReactTextInputOptions = { eventName?: TextFillEvent }

export const fillReactTextInput = (
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  config: FillReactTextInputOptions = { eventName: 'onChange' },
): void => {
  const reactProps = getReactProps(input)
  setNativeInputValue(input, value)
  input.dispatchEvent(new InputEvent('input', { bubbles: true }))
  const eventData = {
    target: input,
    currentTarget: input,
    preventDefault: () => {},
  }
  reactProps?.[config.eventName ?? 'onChange']?.(eventData)
}
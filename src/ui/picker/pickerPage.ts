import { applyAppearanceVars } from '~/ui/donorStyle'
import type { PickerApi } from './pickerApi'
import { readPickerSignal, type PickerContextData } from './protocol'

export type PickerView = { destroy: () => void }

type Activation = { activation: string; view: PickerView | null; stopObserving: (() => void) | null }

export type PickerPageOptions = {
  root: HTMLElement
  target: HTMLElement
  hostId: string
  createApi: (activation: string) => PickerApi
  render: (context: PickerContextData, api: PickerApi, target: HTMLElement) => PickerView
  observe: (element: HTMLElement, report: () => void) => () => void
}

export const createPickerPage = ({ root, target, hostId, createApi, render, observe }: PickerPageOptions) => {
  let current: Activation | null = null

  const setMaxHeight = (px: number) => root.style.setProperty('--tp-picker-max-height', `${px}px`)

  const clear = () => {
    const previous = current
    current = null
    previous?.stopObserving?.()
    previous?.view?.destroy()
    target.replaceChildren()
    root.removeAttribute('style')
    root.removeAttribute('data-tp-mobile')
    root.removeAttribute('data-tp-active')
  }

  const activate = async (activation: string) => {
    clear()
    const entry: Activation = { activation, stopObserving: null, view: null }
    current = entry
    const api = createApi(activation)
    const context = await api.context()
    if (current !== entry) return
    if (!context) {
      clear()
      api.dismiss()
      return
    }
    root.setAttribute('data-tp-mobile', context.mobile ? 'true' : 'false')
    setMaxHeight(context.maxHeight)
    if (context.appearance) applyAppearanceVars(root, context.appearance, 'tp-picker')
    entry.view = render(context, api, target)
    root.setAttribute('data-tp-active', 'true')
    const popover = target.querySelector<HTMLElement>('.popover')
    if (!popover) return
    const report = () => api.resize(Math.ceil(popover.getBoundingClientRect().height))
    entry.stopObserving = observe(popover, report)
    report()
  }

  const onMessage = (message: unknown): void => {
    const signal = readPickerSignal(message, hostId)
    if (!signal) return
    if (signal.kind === 'picker.activate') {
      void activate(signal.activation)
      return
    }
    if (current?.activation !== signal.activation) return
    if (signal.kind === 'picker.deactivate') clear()
    else setMaxHeight(signal.maxHeight)
  }

  return { activeActivation: () => current?.activation ?? null, onMessage }
}

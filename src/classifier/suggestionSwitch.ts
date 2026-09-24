export const CLASSIFIER_SUGGESTIONS_KEY = 'tp.classifierSuggestions'

export type SwitchStorage = {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

export const readClassifierSuggestions = async (storage: SwitchStorage): Promise<boolean> =>
  (await storage.get(CLASSIFIER_SUGGESTIONS_KEY))[CLASSIFIER_SUGGESTIONS_KEY] === true

export const writeClassifierSuggestions = (storage: SwitchStorage, enabled: boolean): Promise<void> =>
  storage.set({ [CLASSIFIER_SUGGESTIONS_KEY]: enabled })

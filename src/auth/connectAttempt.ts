import { browser } from 'wxt/browser'

const STORAGE_KEY = 'tp.latestConnectAttempt'
const TTL_MS = 10 * 60 * 1000

export type ConnectAttempt = {
  connectTabId: number
  originatingTabId: number
  originatingWindowId: number
  openedAt: number
}

export const setConnectAttempt = async (
  attempt: ConnectAttempt,
): Promise<void> => {
  await browser.storage.session.set({ [STORAGE_KEY]: attempt })
}

export const getConnectAttempt = async (): Promise<ConnectAttempt | null> => {
  const res = await browser.storage.session.get(STORAGE_KEY)
  const stored = res[STORAGE_KEY] as ConnectAttempt | undefined
  if (!stored) return null
  if (
    typeof stored.connectTabId !== 'number' ||
    typeof stored.originatingTabId !== 'number' ||
    typeof stored.originatingWindowId !== 'number' ||
    typeof stored.openedAt !== 'number'
  ) {
    return null
  }
  if (Date.now() - stored.openedAt > TTL_MS) {
    await clearConnectAttempt()
    return null
  }
  return stored
}

export const clearConnectAttempt = async (): Promise<void> => {
  await browser.storage.session.remove(STORAGE_KEY)
}
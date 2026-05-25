import { browser } from 'wxt/browser'
import { TOKEN_STORAGE_KEY } from '~/config'
import type { AuthMethod } from '~/bridge/types'

export type Tokens = {
  accessToken: string
  refreshToken: string
  method: AuthMethod | null
}

export const getTokens = async (): Promise<Tokens | null> => {
  const result = await browser.storage.local.get(TOKEN_STORAGE_KEY)
  const stored = result[TOKEN_STORAGE_KEY] as Tokens | undefined
  if (!stored) return null
  if (typeof stored.accessToken !== 'string' || typeof stored.refreshToken !== 'string') {
    return null
  }
  return {
    accessToken: stored.accessToken,
    refreshToken: stored.refreshToken,
    method: stored.method ?? null,
  }
}

export const setTokens = async (tokens: Tokens): Promise<void> => {
  await browser.storage.local.set({ [TOKEN_STORAGE_KEY]: tokens })
}

export const clearTokens = async (): Promise<void> => {
  await browser.storage.local.remove(TOKEN_STORAGE_KEY)
}
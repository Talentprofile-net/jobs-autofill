export type ApplicationContextStorage = {
  get(key: string): Promise<Record<string, unknown>>
  remove(key: string | string[]): Promise<void>
  set(items: Record<string, unknown>): Promise<void>
}

type PendingHandoff = {
  applicationId: string
  destinationUrl: string
  expiresAt: number
}

type PendingTab = {
  currentUrl: string
  expiresAt: number
  tabId: number
}

type BoundContext = { applicationId: string }

const TTL_MS = 10 * 60 * 1000
const handoffKey = (openerTabId: number) =>
  `tp.applicationContext.handoff.${openerTabId}`
const pendingTabKey = (openerTabId: number) =>
  `tp.applicationContext.pendingTab.${openerTabId}`
const tabKey = (tabId: number) => `tp.applicationContext.tab.${tabId}`

const normalizedDestination = (value: string): string | null => {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}

const read = async <T>(
  storage: ApplicationContextStorage,
  key: string,
): Promise<T | null> => {
  const value = (await storage.get(key))[key]
  return value && typeof value === 'object' ? (value as T) : null
}

const bind = async (
  storage: ApplicationContextStorage,
  openerTabId: number,
  handoff: PendingHandoff,
  pendingTab: PendingTab,
  now: number,
): Promise<void> => {
  if (handoff.expiresAt < now || pendingTab.expiresAt < now) {
    await storage.remove([
      handoffKey(openerTabId),
      pendingTabKey(openerTabId),
    ])
    return
  }
  if (
    normalizedDestination(handoff.destinationUrl) !==
    normalizedDestination(pendingTab.currentUrl)
  ) {
    return
  }
  await storage.set({
    [tabKey(pendingTab.tabId)]: { applicationId: handoff.applicationId },
  })
  await storage.remove([handoffKey(openerTabId), pendingTabKey(openerTabId)])
}

export const registerApplicationHandoff = async (
  storage: ApplicationContextStorage,
  openerTabId: number,
  applicationId: string,
  destinationUrl: string,
  now = Date.now(),
): Promise<void> => {
  if (!normalizedDestination(destinationUrl)) return
  const handoff = { applicationId, destinationUrl, expiresAt: now + TTL_MS }
  await storage.set({ [handoffKey(openerTabId)]: handoff })
  const pendingTab = await read<PendingTab>(storage, pendingTabKey(openerTabId))
  if (pendingTab) await bind(storage, openerTabId, handoff, pendingTab, now)
}

export const registerOpenedApplicationTab = async (
  storage: ApplicationContextStorage,
  openerTabId: number,
  tabId: number,
  currentUrl: string,
  now = Date.now(),
): Promise<void> => {
  const pendingTab = { currentUrl, expiresAt: now + TTL_MS, tabId }
  await storage.set({ [pendingTabKey(openerTabId)]: pendingTab })
  const handoff = await read<PendingHandoff>(storage, handoffKey(openerTabId))
  if (handoff) await bind(storage, openerTabId, handoff, pendingTab, now)
}

export const updateOpenedApplicationTab = async (
  storage: ApplicationContextStorage,
  openerTabId: number,
  tabId: number,
  currentUrl: string,
  now = Date.now(),
): Promise<void> => {
  const pending = await read<PendingTab>(storage, pendingTabKey(openerTabId))
  if (!pending || pending.tabId !== tabId) return
  await registerOpenedApplicationTab(
    storage,
    openerTabId,
    tabId,
    currentUrl,
    now,
  )
}

export const readApplicationContextForTab = async (
  storage: ApplicationContextStorage,
  tabId: number,
): Promise<string | null> => {
  const key = tabKey(tabId)
  const context = await read<BoundContext>(storage, key)
  if (!context) return null
  return context.applicationId
}

export const clearApplicationContextForTab = (
  storage: ApplicationContextStorage,
  tabId: number,
): Promise<void> => storage.remove(tabKey(tabId))

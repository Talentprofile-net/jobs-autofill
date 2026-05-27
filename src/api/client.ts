import { API_BASE_URL } from '~/config'
import { clearTokens, getTokens, setTokens } from '~/auth/tokenStorage'
import { isExpired } from '~/auth/jwt'

type RequestInit2 = RequestInit & { skipAuth?: boolean; timeoutMs?: number }

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NetworkError'
  }
}

type RefreshResponse = {
  token: string
  refreshToken: string
}

export type RefreshOutcome =
  | { kind: 'ok' }
  | { kind: 'rejected' }
  | { kind: 'network' }

const DEFAULT_TIMEOUT_MS = 15_000

let inflightRefresh: Promise<RefreshOutcome> | null = null

const performRefresh = async (): Promise<RefreshOutcome> => {
  const tokens = await getTokens()
  if (!tokens?.refreshToken) {
    await clearTokens()
    return { kind: 'rejected' }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      signal: controller.signal,
    })
  } catch {
    clearTimeout(timer)
    return { kind: 'network' }
  }
  clearTimeout(timer)
  if (res.status === 401 || res.status === 403) {
    await clearTokens()
    return { kind: 'rejected' }
  }
  if (!res.ok) {
    return { kind: 'network' }
  }
  let data: RefreshResponse
  try {
    data = (await res.json()) as RefreshResponse
  } catch {
    return { kind: 'network' }
  }
  if (typeof data.token !== 'string' || typeof data.refreshToken !== 'string') {
    return { kind: 'network' }
  }
  await setTokens({
    accessToken: data.token,
    refreshToken: data.refreshToken,
    method: tokens.method,
  })
  return { kind: 'ok' }
}

const tryRefresh = (): Promise<RefreshOutcome> => {
  if (inflightRefresh) return inflightRefresh
  inflightRefresh = performRefresh().finally(() => {
    inflightRefresh = null
  })
  return inflightRefresh
}

const ensureFreshToken = async (): Promise<RefreshOutcome> => {
  const tokens = await getTokens()
  if (!tokens?.accessToken) return { kind: 'rejected' }
  if (!isExpired(tokens.accessToken)) return { kind: 'ok' }
  return tryRefresh()
}

const normalizeHeaders = (input: HeadersInit | undefined): Record<string, string> => {
  const out: Record<string, string> = {}
  if (!input) return out
  if (input instanceof Headers) {
    input.forEach((value, key) => {
      out[key] = value
    })
    return out
  }
  if (Array.isArray(input)) {
    for (const entry of input) {
      if (Array.isArray(entry) && entry.length === 2) {
        out[entry[0]] = entry[1]
      }
    }
    return out
  }
  for (const key of Object.keys(input)) {
    const value = (input as Record<string, string>)[key]
    if (typeof value === 'string') {
      out[key] = value
    }
  }
  return out
}

const buildHeaders = async (init: RequestInit2): Promise<HeadersInit> => {
  const headers = normalizeHeaders(init.headers)
  if (init.body && !headers['Content-Type'] && !(init.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }
  if (!init.skipAuth) {
    const tokens = await getTokens()
    if (tokens?.accessToken) {
      headers.Authorization = `Bearer ${tokens.accessToken}`
    }
  }
  return headers
}

const parseErrorBody = async (res: Response): Promise<string> => {
  const contentType = res.headers.get('content-type') ?? ''
  const cloned = res.clone()
  try {
    if (contentType.includes('application/json')) {
      const body = await cloned.json()
      if (body && typeof body === 'object') {
        const obj = body as Record<string, unknown>
        if (typeof obj.error === 'string') return obj.error
        if (typeof obj.message === 'string') return obj.message
      }
      return JSON.stringify(body)
    }
    const text = await cloned.text()
    return text || res.statusText
  } catch {
    return res.statusText
  }
}

export const apiFetch = async <T>(
  path: string,
  init: RequestInit2 = {},
): Promise<T | undefined> => {
  if (!init.skipAuth) {
    const outcome = await ensureFreshToken()
    if (outcome.kind === 'network') {
      throw new NetworkError('Could not reach auth server')
    }
    if (outcome.kind === 'rejected') {
      throw new AuthError('No valid session')
    }
  }

  const url = `${API_BASE_URL}${path}`
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const doFetch = async (): Promise<Response> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetch(url, {
        ...init,
        headers: await buildHeaders(init),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  let res: Response
  try {
    res = await doFetch()
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new NetworkError(`Request timed out after ${timeoutMs}ms`)
    }
    throw new NetworkError((e as Error).message || 'Network error')
  }

  if (res.status === 401 && !init.skipAuth) {
    const outcome = await tryRefresh()
    if (outcome.kind === 'ok') {
      try {
        res = await doFetch()
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          throw new NetworkError(`Request timed out after ${timeoutMs}ms`)
        }
        throw new NetworkError((e as Error).message || 'Network error')
      }
    } else if (outcome.kind === 'network') {
      throw new NetworkError('Could not reach auth server')
    } else {
      throw new AuthError('No valid session')
    }
  }

  if (!res.ok) {
    const message = await parseErrorBody(res)
    throw new ApiError(res.status, message || `Request failed: ${res.status}`)
  }

  if (res.status === 204) {
    return undefined
  }

  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return (await res.json()) as T
  }
  const text = await res.text().catch(() => '')
  if (text.length === 0) {
    return undefined
  }
  return undefined
}

export const refreshAccessToken = (): Promise<RefreshOutcome> => tryRefresh()
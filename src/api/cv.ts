import { apiFetchBytes, ApiError } from './client'

export const fetchOwnCvBytes = async (): Promise<Uint8Array | null> => {
  try {
    return await apiFetchBytes('/api/v1/talentprofile/cv-file', {
      headers: { Accept: 'application/pdf' },
      method: 'GET',
      timeoutMs: 30_000,
    })
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null
    throw e
  }
}

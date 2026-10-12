import { isUnrelatedFrameUrl } from './frameOrigins'

const UTILITY_TOKEN =
  /^([a-z0-9]{1,12}[-_])?(sw[_-]?iframe|service[_-]?worker|ns(?=\.html?$)|pixel|beacon|track(ing)?|cookie[_-]?sync|getuid|sync|analytics|tagmanager|collect|rum)([-_][a-z0-9]{1,12})?(\.[a-z0-9]{1,5})?$/i

export const MIN_FRAME_WIDTH = 240
export const MIN_FRAME_HEIGHT = 160
export const MIN_FRAME_CONTROLS = 3

export type FrameGeometry = { width: number; height: number; visible: boolean }

export type FrameSurfaceEvidence = {
  url: string
  geometry?: FrameGeometry | null
  controls?: number | null
}

export const isUtilityFrameUrl = (url: string): boolean => {
  if (isUnrelatedFrameUrl(url)) return true
  try {
    const parsed = new URL(url)
    const tokens = [...parsed.pathname.split('/'), ...parsed.searchParams.keys()]
    return tokens.some((token) => UTILITY_TOKEN.test(token))
  } catch {
    return false
  }
}

export const isApplicationFrameSurface = (evidence: FrameSurfaceEvidence): boolean => {
  if (isUtilityFrameUrl(evidence.url)) return false
  if (typeof evidence.controls === 'number') return evidence.controls >= MIN_FRAME_CONTROLS
  if (evidence.geometry) {
    const { width, height, visible } = evidence.geometry
    return visible && width >= MIN_FRAME_WIDTH && height >= MIN_FRAME_HEIGHT
  }
  return false
}

export const measureIframesInPage = (): Array<{ src: string; width: number; height: number; visible: boolean }> =>
  Array.from(document.querySelectorAll('iframe')).map((frame) => {
    const rect = frame.getBoundingClientRect()
    const style = getComputedStyle(frame)
    return {
      height: rect.height,
      src: frame.src,
      visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
      width: rect.width,
    }
  })

export const countFillableControlsInPage = (): number => {
  const selector = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea, select, [role="combobox"], [role="radiogroup"]'
  const scopes: Array<Document | ShadowRoot> = [document]
  for (let i = 0; i < scopes.length; i++) {
    for (const el of Array.from(scopes[i].querySelectorAll('*'))) {
      if (el.shadowRoot) scopes.push(el.shadowRoot)
    }
  }
  return scopes
    .flatMap((scope) => Array.from(scope.querySelectorAll(selector)))
    .filter((el) => {
      const rect = el.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }).length
}

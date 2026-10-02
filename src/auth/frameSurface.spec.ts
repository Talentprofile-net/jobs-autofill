import { describe, expect, it } from 'bun:test'

import { isApplicationFrameSurface, isUtilityFrameUrl } from './frameSurface'

const NESTLE_SW = 'https://data-na.nestlejobs.com/_/service_worker/69f0/sw_iframe.html?origin=https%3A%2F%2Fjobdetails.nestle.com&1p=1'

describe('embedded frames offered as application surfaces', () => {
  it('rejects the Nestle service-worker utility frame even when nothing else is known', () => {
    expect(isUtilityFrameUrl(NESTLE_SW)).toBe(true)
    expect(isApplicationFrameSurface({ url: NESTLE_SW })).toBe(false)
    expect(isApplicationFrameSurface({ controls: null, geometry: null, url: NESTLE_SW })).toBe(false)
    expect(isApplicationFrameSurface({ geometry: { height: 0, visible: false, width: 0 }, url: NESTLE_SW })).toBe(false)
  })

  it('rejects analytics, ad-sync and captcha frames', () => {
    for (const url of [
      'https://www.googletagmanager.com/ns.html?id=GTM-1',
      'https://match.adsrvr.org/track/cei?advertiser_id=1&cookie_sync=1',
      'https://ib.adnxs.com/getuid?https%3a%2f%2fexample.invalid',
      'https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html',
    ]) expect(isApplicationFrameSurface({ geometry: { height: 600, visible: true, width: 800 }, url })).toBe(false)
  })

  it('accepts a visible, sizable cross-origin application frame', () => {
    expect(isApplicationFrameSurface({ geometry: { height: 1400, visible: true, width: 820 }, url: 'https://careers-acme.icims.com/jobs/1/job?mode=apply&in_iframe=1' })).toBe(true)
  })

  it('rejects a hidden or tiny frame on an otherwise ordinary host', () => {
    expect(isApplicationFrameSurface({ geometry: { height: 1, visible: true, width: 1 }, url: 'https://forms.example.invalid/apply' })).toBe(false)
    expect(isApplicationFrameSurface({ geometry: { height: 900, visible: false, width: 800 }, url: 'https://forms.example.invalid/apply' })).toBe(false)
  })

  it('rejects an ordinary frame when neither controls nor geometry could be read', () => {
    expect(isApplicationFrameSurface({ url: 'https://careers-acme.icims.com/jobs/1/job?mode=apply' })).toBe(false)
    expect(isApplicationFrameSurface({ controls: null, geometry: null, url: 'https://apply.example.invalid/form' })).toBe(false)
  })

  it('uses discovered control counts when the frame can be inspected', () => {
    expect(isApplicationFrameSurface({ controls: 12, url: 'https://boards.greenhouse.io/acme/jobs/1' })).toBe(true)
    expect(isApplicationFrameSurface({ controls: 1, geometry: { height: 900, visible: true, width: 800 }, url: 'https://boards.greenhouse.io/acme/jobs/1' })).toBe(false)
  })
})

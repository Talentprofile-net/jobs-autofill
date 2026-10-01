import { describe, expect, it } from 'bun:test'

import { isUnrelatedFrameUrl } from './frameOrigins'

const OBSERVED_WIDGET_FRAMES = [
  'https://www.recaptcha.net/recaptcha/api2/anchor?ar=1&k=6LeFb_YUAAAAALUD5h-BiQEp8JaFChe0e0A',
  'https://www.recaptcha.net/recaptcha/api2/bframe?hl=en&v=kemdRjWFxNjgsGdhRslyEPwU',
  'https://www.google.com/recaptcha/api2/anchor?ar=1&k=6LfZ4KEsAAAAAP7osErua7mOIzcdDjnUdaZfp0',
  'https://newassets.hcaptcha.com/captcha/v1/b9ca2a6602c2bf69741b771db488f3001ea35b08/static/hcaptcha.html',
  'https://captcha-assets.recruiteecdn.com/captcha/v1/b9ca2a6602c2bf69741b771db488f3001ea35b0/static/hcaptcha.html',
  'https://app.qualified.com/w/1/xx7tZXtEZ4gTh9UQ/messenger?uuid=4238e077-8075-493b-8754-f62da8114ff3',
  'https://www.linkedin.com/talentwidgets/apply-with-linkedin#xdOrigin=https%3A%2F%2Fjobs.smartrecruiters.com',
  'https://smartapply.indeed.com/beta/indeedapply/preloadresumeapply',
  'https://platform.twitter.com/widgets/widget_iframe.1227a5674072e080ffb1ba14ac0c1079.html',
  'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0/rcv/abc',
]

const FORM_FRAMES = [
  'https://careers-barrios.icims.com/jobs/2897/login?in_iframe=1',
  'https://boards.greenhouse.io/embed/job_app?for=acme&token=123',
  'https://jobs.lever.co/spotify/65d6caca-6d7c-4049-8256-a128e0e7249e/apply',
  'https://docs.google.com/forms/d/e/abc/viewform',
  'https://www.google.com/search?q=jobs',
  'https://apply.workable.com/canvas8/j/348C50E1B6/apply/',
]

describe('isUnrelatedFrameUrl', () => {
  for (const url of OBSERVED_WIDGET_FRAMES) {
    it(`hides the CAPTCHA, chat or social frame ${new URL(url).hostname}`, () => {
      expect(isUnrelatedFrameUrl(url)).toBe(true)
    })
  }

  for (const url of FORM_FRAMES) {
    it(`keeps the possible form frame ${new URL(url).hostname}${new URL(url).pathname.slice(0, 12)}`, () => {
      expect(isUnrelatedFrameUrl(url)).toBe(false)
    })
  }

  it('does not match a host that only ends with a listed name', () => {
    expect(isUnrelatedFrameUrl('https://notlinkedin.com/apply')).toBe(false)
  })

  it('treats an unparsable url as not unrelated', () => {
    expect(isUnrelatedFrameUrl('not a url')).toBe(false)
  })
})

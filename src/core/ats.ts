import type { AtsName } from '~/field/types'

export const detectAts = (host: string = window.location.hostname): AtsName => {
  if (host.endsWith('.myworkdayjobs.com')) return 'workday'
  if (host === 'boards.greenhouse.io') return 'greenhouseClassic'
  if (host === 'job-boards.greenhouse.io') return 'greenhouseReact'
  return 'generic'
}

export const isAtsHost = (host: string = window.location.hostname): boolean => {
  const ats = detectAts(host)
  return ats !== 'generic'
}
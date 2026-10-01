import type { AnswerCaptureRecord, BackgroundResponse, ContentToBackground } from '~/bridge/types'
import type { AtsName } from '~/field/types'
import { detectSubmitOutcome } from './submitDetection'

type Send = <T = unknown>(message: ContentToBackground) => Promise<BackgroundResponse<T>>

// Everything is read and handed off BEFORE detection runs, not after.
//
// Detection waits up to 8 seconds and then reads `location.href`. Both halves of
// that are wrong on a real submit: a classic full-page POST destroys this content
// script long before the deadline, taking the buffered fields with it, and an
// SPA that reaches a confirmation route has already replaced the URL the answers
// belong to with a `/thank-you` that identifies no job.
//
// So submit-time snapshots the page URL and serialises every field, and stages
// that batch with the background worker — which outlives the page. Detection then
// only decides whether the staged batch commits or is discarded.
export const stageSubmittedAnswers = async (
  send: Send,
  ats: AtsName,
  form: HTMLElement | null,
  records: AnswerCaptureRecord[],
): Promise<void> => {
  if (records.length === 0) return
  const staged = await send<{ stageId: string }>({
    kind: 'answers.stage',
    payload: { applicationUrl: location.href, ats, records },
  })
  if (!staged.ok || !staged.data?.stageId) return
  const stageId = staged.data.stageId
  const outcome = await detectSubmitOutcome(form, ats)
  if (outcome === 'success') {
    await send({ kind: 'answers.commit', stageId })
    return
  }
  // Detection leans toward false positives by design, so `unknown` is not a
  // silent drop: the background worker still commits a stage that a
  // top-level navigation cut short, which is the case detection cannot
  // observe from inside a page that no longer exists.
  await send({ kind: 'answers.discard', outcome, stageId })
}

import {
  MASKED_LOGIT,
  REASON_PRECEDENCE,
  type AbstentionReason,
  type Decision,
  type DecisionContext,
  type LabelMap,
  type SelectivePolicy,
} from '~/classifier/contract'

export function shapeMaskedLogits(logits: number[], valueShapes: string[], answerKind: string): number[] {
  if (logits.length !== valueShapes.length) throw new Error('logit width must equal the value shape count')
  if (!valueShapes.includes(answerKind)) return [...logits]
  return logits.map((value, index) => (valueShapes[index] === answerKind ? value : MASKED_LOGIT))
}

export function calibratedProbabilities(logits: number[], temperature: number | null): number[] {
  const scale = temperature ?? 1
  const scaled = logits.map((value) => value / scale)
  const peak = Math.max(...scaled)
  const exponentials = scaled.map((value) => Math.exp(value - peak))
  const total = exponentials.reduce((sum, value) => sum + value, 0)
  return exponentials.map((value) => value / total)
}

export function topTwo(probabilities: number[]): { index: number; confidence: number; margin: number } {
  let index = 0
  let first = probabilities[0] ?? 0
  let second = 0
  for (let position = 1; position < probabilities.length; position += 1) {
    const value = probabilities[position]
    if (value > first) {
      second = first
      first = value
      index = position
    } else if (value > second) {
      second = value
    }
  }
  return { index, confidence: first, margin: first - second }
}

export function gateReasons({
  policy,
  labelMap,
  index,
  confidence,
  margin,
  context,
  applyConfidence,
}: {
  policy: SelectivePolicy
  labelMap: LabelMap
  index: number
  confidence: number
  margin: number
  context: DecisionContext
  applyConfidence: boolean
}): AbstentionReason[] {
  const entry = labelMap.labels[index]
  const triggered = new Set<AbstentionReason>()
  if (context.unknownQuestion) triggered.add('unknown_question')
  if (policy.blockedClasses.includes(entry.labelEnumId) || entry.countryScopeReview === 'unreviewed') {
    triggered.add('class_not_evaluable')
  }
  if (entry.valueShape !== context.answerKind) triggered.add('value_shape_mismatch')
  if (entry.countryScope !== null && entry.countryScope !== context.jobCountry) {
    triggered.add('country_mismatch')
  }
  if (policy.marginThreshold !== null && margin < policy.marginThreshold) triggered.add('low_margin')
  if (applyConfidence) {
    const threshold = policy.perClassThresholds[entry.labelEnumId] ?? policy.globalThreshold
    if (!policy.automaticAcceptanceEnabled || threshold === null) triggered.add('acceptance_disabled')
    else if (confidence < threshold) triggered.add('low_confidence')
  }
  return REASON_PRECEDENCE.filter((reason) => triggered.has(reason))
}

export function decide({
  logits,
  policy,
  labelMap,
  context,
  modelVersion,
}: {
  logits: number[]
  policy: SelectivePolicy
  labelMap: LabelMap
  context: DecisionContext
  modelVersion: string
}): Decision {
  if (logits.length !== labelMap.labels.length) throw new Error('logit width must equal the label count')
  const masked = shapeMaskedLogits(
    logits,
    labelMap.labels.map((entry) => entry.valueShape),
    context.answerKind,
  )
  const { index, confidence, margin } = topTwo(calibratedProbabilities(masked, policy.temperature))
  const reasons = gateReasons({
    policy,
    labelMap,
    index,
    confidence,
    margin,
    context,
    applyConfidence: true,
  })
  const top = labelMap.labels[index].labelEnumId
  return {
    labelEnumId: reasons.length ? null : top,
    topLabelEnumId: top,
    calibratedConfidence: confidence,
    margin,
    abstentionReason: reasons[0] ?? null,
    triggeredReasons: reasons,
    modelVersion,
  }
}

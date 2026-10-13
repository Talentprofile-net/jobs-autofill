import { genericCandidates, describeGenericCandidate } from '~/adapters/generic/plan'
import { datePartsOf } from '~/adapters/generic/dateGroups'
import { groupPartsOf } from '~/adapters/generic/groupParts'
import { pureGroupHooks } from '~/adapters/generic/groups'
import { createSectionReader as createGenericSectionReader } from '~/adapters/generic/sections'
import { classicSectionNumbers } from '~/adapters/greenhouseClassic/sections'
import { SPEC_ORDER as CLASSIC_SPECS } from '~/adapters/greenhouseClassic/specs'
import { sectionNumbers } from '~/adapters/greenhouseReact/sectionNumbers'
import { hasApplicationContainer, SPEC_ORDER as REACT_SPECS } from '~/adapters/greenhouseReact/specs'
import { createSectionReader as createWorkdaySectionReader } from '~/adapters/workday/sectionKind'
import { isJobSearchPage, SPEC_ORDER as WORKDAY_SPECS } from '~/adapters/workday/specs'
import { createMemoryClaims, type MemoryClaims } from '~/field/claims'
import { isVisible } from '~/field/fieldVisibility'
import { detectFormContainer } from '~/field/formContainer'
import type { AtsName } from '~/field/types'
import { nearestMapped, walkAtsCandidates, type AtsFieldSpec } from './atsSpec'

export type FieldDescription = {
  element: HTMLElement
  fieldName: string
  fieldType: string
  section: string
  visible: boolean
  fillable: boolean
}

const describeAts = (
  specs: ReadonlyArray<AtsFieldSpec>,
  root: Node,
  isClaimed: (claims: MemoryClaims, element: HTMLElement) => boolean,
  sectionOf: (element: HTMLElement) => string,
): FieldDescription[] => {
  const claims = createMemoryClaims()
  const out: FieldDescription[] = []
  walkAtsCandidates(specs, root, (element) => isClaimed(claims, element), (index, element) => {
    claims.mark(element)
    const spec = specs[index]
    out.push({ element, fieldName: spec.fieldName(element), fieldType: spec.fieldType, fillable: spec.fillable(element), section: sectionOf(element), visible: isVisible(element) })
  })
  return out
}

const describeGeneric = (root: ParentNode): FieldDescription[] => {
  const claims = createMemoryClaims()
  const sectionOf = createGenericSectionReader()
  const out: FieldDescription[] = []
  for (const candidate of genericCandidates(root, claims, pureGroupHooks)) {
    claims.mark(candidate.element)
    const parts =
      candidate.kind === 'date'
        ? datePartsOf(candidate.group)
        : candidate.kind === 'radioGroup' || candidate.kind === 'checkboxGroup'
          ? groupPartsOf(candidate.element, claims.isMarked)
          : []
    for (const part of parts) claims.markPart(part)
    out.push({ element: candidate.element, ...describeGenericCandidate(candidate), section: sectionOf(candidate.element) })
  }
  return out
}

export const describeFields = (ats: AtsName): FieldDescription[] => {
  const root = detectFormContainer(ats)
  if (ats === 'greenhouseClassic') {
    const numbers = classicSectionNumbers()
    return describeAts(CLASSIC_SPECS, root, (claims, element) => claims.isMarked(element), (element) => nearestMapped(element, numbers))
  }
  if (ats === 'greenhouseReact') {
    if (!hasApplicationContainer()) return []
    const numbers = sectionNumbers()
    return describeAts(REACT_SPECS, root, (claims, element) => claims.isInside(element), (element) => nearestMapped(element, numbers))
  }
  if (ats === 'workday') {
    if (isJobSearchPage()) return []
    return describeAts(WORKDAY_SPECS, root, (claims, element) => claims.isMarked(element), createWorkdaySectionReader())
  }
  return describeGeneric(root)
}

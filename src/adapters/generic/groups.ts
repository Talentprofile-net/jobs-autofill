import type { Claims } from '~/field/claims'
import { querySelectorAllDeep } from '~/core/shadowDom'
import {
  explicitGroup,
  groupKeyOf,
  isEligibleOption,
  sameKeyOptions,
  type ChoiceInput,
} from './groupParts'

export type ChoiceGroup = {
  anchor: ChoiceInput
}

export type Discovery = { singles: ChoiceInput[]; groups: ChoiceGroup[] }

export type GroupHooks = {
  dropStalePart: (el: ChoiceInput) => void
  adoptRegistered: (anchor: ChoiceInput, seed: ChoiceInput, eligible: ChoiceInput[], out: Discovery) => void
}

export const pureGroupHooks: GroupHooks = {
  adoptRegistered: () => {},
  dropStalePart: () => {},
}

const ownedByOtherField = (el: ChoiceInput, claims: Claims): boolean =>
  !claims.isMarked(el) && !claims.isPart(el) && claims.isInside(el)

const registeredAnchor = (options: ChoiceInput[], claims: Claims): ChoiceInput | null =>
  options.find((o) => claims.isMarked(o) && o.isConnected) ?? null

const reconcile = (seed: ChoiceInput, out: Discovery, claims: Claims, hooks: GroupHooks): void => {
  const options = sameKeyOptions(seed)
  for (const option of options) hooks.dropStalePart(option)
  const eligible = options.filter((o) => isEligibleOption(o) && !ownedByOtherField(o, claims))
  const anchor = registeredAnchor(options, claims)
  if (anchor) {
    hooks.adoptRegistered(anchor, seed, eligible, out)
    return
  }
  const free = eligible.filter((o) => !claims.isPart(o))
  if (free.length > 1) {
    out.groups.push({ anchor: free[0] })
  } else if (free.length === 1 && seed.type === 'checkbox') {
    out.singles.push(free[0])
  }
}

const discoverNamed = (root: ParentNode, type: 'checkbox' | 'radio', out: Discovery, claims: Claims, hooks: GroupHooks): void => {
  const seen = new Set<string>()
  for (const option of querySelectorAllDeep<ChoiceInput>(root as Node, `input[type="${type}"]`)) {
    if (!option.name) continue
    hooks.dropStalePart(option)
    if (!isEligibleOption(option) || ownedByOtherField(option, claims)) continue
    const key = groupKeyOf(option)
    if (seen.has(key)) continue
    seen.add(key)
    reconcile(option, out, claims, hooks)
  }
}

export const discoverRadioGroups = (root: ParentNode, claims: Claims, hooks: GroupHooks): ChoiceGroup[] => {
  const out: Discovery = { groups: [], singles: [] }
  discoverNamed(root, 'radio', out, claims, hooks)
  return out.groups
}

export const discoverCheckboxGroups = (root: ParentNode, claims: Claims, hooks: GroupHooks): Discovery => {
  const out: Discovery = { groups: [], singles: [] }
  discoverNamed(root, 'checkbox', out, claims, hooks)
  const unnamedByContainer = new Map<HTMLElement, ChoiceInput[]>()
  for (const cb of querySelectorAllDeep<ChoiceInput>(root as Node, 'input[type="checkbox"]')) {
    if (cb.name) continue
    hooks.dropStalePart(cb)
    if (claims.isInside(cb) || claims.isPart(cb) || !isEligibleOption(cb)) continue
    const container = explicitGroup(cb)
    if (!container) {
      out.singles.push(cb)
      continue
    }
    const list = unnamedByContainer.get(container) ?? []
    list.push(cb)
    unnamedByContainer.set(container, list)
  }
  for (const [container, inputs] of unnamedByContainer) {
    const hasNamed = Array.from(container.querySelectorAll<ChoiceInput>('input[type="checkbox"]')).some((el) => el.name)
    if (inputs.length > 1 && !hasNamed) out.groups.push({ anchor: inputs[0] })
    else out.singles.push(...inputs)
  }
  return out
}

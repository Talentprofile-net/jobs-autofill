import { FIELD_MARKER_ATTR } from '~/config'
import { fieldByUuid } from '~/field/registry'
import { isInsideRegistered } from '~/field/baseField'
import { querySelectorAllDeep } from '~/core/shadowDom'
import {
  claimParts,
  dropStalePart,
  explicitGroup,
  groupKeyOf,
  isEligibleOption,
  isGroupPart,
  sameKeyOptions,
  type ChoiceInput,
} from './groupParts'

export type ChoiceGroup = {
  anchor: ChoiceInput
}

type Discovery = { singles: ChoiceInput[]; groups: ChoiceGroup[] }

const ownedByOtherField = (el: ChoiceInput): boolean =>
  !el.hasAttribute(FIELD_MARKER_ATTR) && !isGroupPart(el) && isInsideRegistered(el)

const registeredAnchor = (options: ChoiceInput[]): ChoiceInput | null =>
  options.find((o) => o.hasAttribute(FIELD_MARKER_ATTR) && o.isConnected) ?? null

const reconcile = (seed: ChoiceInput, out: Discovery): void => {
  const options = sameKeyOptions(seed)
  for (const option of options) dropStalePart(option)
  const eligible = options.filter((o) => isEligibleOption(o) && !ownedByOtherField(o))
  const anchor = registeredAnchor(options)
  if (anchor) {
    const uuid = anchor.getAttribute(FIELD_MARKER_ATTR)!
    const field = fieldByUuid(uuid)
    const isGroupField = field?.fieldType === 'MultiCheckbox' || field?.fieldType === 'RadioGroup'
    if (isGroupField) {
      claimParts(anchor, uuid)
      return
    }
    if (field && seed.type === 'checkbox' && eligible.length > 1) {
      field.destroy()
      out.groups.push({ anchor: eligible[0] })
    }
    return
  }
  const free = eligible.filter((o) => !isGroupPart(o))
  if (free.length > 1) {
    out.groups.push({ anchor: free[0] })
  } else if (free.length === 1 && seed.type === 'checkbox') {
    out.singles.push(free[0])
  }
}

const discoverNamed = (root: ParentNode, type: 'checkbox' | 'radio', out: Discovery): void => {
  const seen = new Set<string>()
  for (const option of querySelectorAllDeep<ChoiceInput>(root as Node, `input[type="${type}"]`)) {
    if (!option.name) continue
    dropStalePart(option)
    if (!isEligibleOption(option) || ownedByOtherField(option)) continue
    const key = groupKeyOf(option)
    if (seen.has(key)) continue
    seen.add(key)
    reconcile(option, out)
  }
}

export const discoverRadioGroups = (root: ParentNode): ChoiceGroup[] => {
  const out: Discovery = { groups: [], singles: [] }
  discoverNamed(root, 'radio', out)
  return out.groups
}

export const discoverCheckboxGroups = (root: ParentNode): Discovery => {
  const out: Discovery = { groups: [], singles: [] }
  discoverNamed(root, 'checkbox', out)
  const unnamedByContainer = new Map<HTMLElement, ChoiceInput[]>()
  for (const cb of querySelectorAllDeep<ChoiceInput>(root as Node, 'input[type="checkbox"]')) {
    if (cb.name) continue
    dropStalePart(cb)
    if (isInsideRegistered(cb) || isGroupPart(cb) || !isEligibleOption(cb)) continue
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

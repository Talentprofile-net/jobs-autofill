import { isInsideRegistered, isVisible } from '~/field/baseField'

export type RadioGroup = {
  anchor: HTMLInputElement
  inputs: HTMLInputElement[]
  name: string
}

export type CheckboxGroup = {
  anchor: HTMLInputElement
  inputs: HTMLInputElement[]
  groupKey: string
}

const groupingContainer = (input: HTMLElement): HTMLElement => {
  const fieldset = input.closest('fieldset') as HTMLElement | null
  if (fieldset) return fieldset
  const role = input.closest('[role="group"]') as HTMLElement | null
  if (role) return role
  return input.parentElement ?? document.body
}

export const discoverRadioGroups = (root: ParentNode): RadioGroup[] => {
  const radios = Array.from(
    root.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  ).filter((el) => {
    if (isInsideRegistered(el)) return false
    if (!isVisible(el)) return false
    if (el.hasAttribute('disabled')) return false
    return true
  })

  const grouped = new Map<string, HTMLInputElement[]>()
  for (const radio of radios) {
    const name = radio.name
    if (!name) continue
    const list = grouped.get(name) ?? []
    list.push(radio)
    grouped.set(name, list)
  }

  const groups: RadioGroup[] = []
  for (const [name, inputs] of grouped) {
    if (inputs.length < 2) continue
    groups.push({
      anchor: inputs[0],
      inputs,
      name,
    })
  }
  return groups
}

export const discoverCheckboxGroups = (
  root: ParentNode,
): { singles: HTMLInputElement[]; groups: CheckboxGroup[] } => {
  const checkboxes = Array.from(
    root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  ).filter((el) => {
    if (isInsideRegistered(el)) return false
    if (!isVisible(el)) return false
    if (el.hasAttribute('disabled')) return false
    return true
  })

  const byContainer = new Map<HTMLElement, HTMLInputElement[]>()
  for (const cb of checkboxes) {
    const container = groupingContainer(cb)
    const list = byContainer.get(container) ?? []
    list.push(cb)
    byContainer.set(container, list)
  }

  const singles: HTMLInputElement[] = []
  const groups: CheckboxGroup[] = []

  for (const [container, inputs] of byContainer) {
    if (inputs.length === 1) {
      singles.push(inputs[0])
      continue
    }

    const tag = container.tagName.toLowerCase()
    const isExplicitGroup = tag === 'fieldset' || container.getAttribute('role') === 'group'

    const byName = new Map<string, HTMLInputElement[]>()
    const noName: HTMLInputElement[] = []
    for (const cb of inputs) {
      if (cb.name) {
        const list = byName.get(cb.name) ?? []
        list.push(cb)
        byName.set(cb.name, list)
      } else {
        noName.push(cb)
      }
    }

    for (const [name, namedInputs] of byName) {
      if (namedInputs.length === 1) {
        singles.push(namedInputs[0])
      } else {
        groups.push({
          anchor: namedInputs[0],
          inputs: namedInputs,
          groupKey: name,
        })
      }
    }

    if (noName.length > 0) {
      if (isExplicitGroup && byName.size === 0) {
        groups.push({
          anchor: noName[0],
          inputs: noName,
          groupKey:
            container.id ||
            container.getAttribute('aria-labelledby') ||
            `cb-${groups.length}`,
        })
      } else {
        for (const cb of noName) singles.push(cb)
      }
    }
  }

  return { singles, groups }
}
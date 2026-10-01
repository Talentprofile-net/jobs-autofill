type QueryRoot = Document | Element | DocumentFragment

const isQueryRoot = (node: Node): node is QueryRoot =>
  typeof (node as QueryRoot).querySelectorAll === 'function'

export const openShadowRoots = (root: Node): ShadowRoot[] => {
  if (!isQueryRoot(root)) return []
  const found = new Set<ShadowRoot>()
  const visit = (scope: QueryRoot): void => {
    const hosts = scope instanceof Element && scope.shadowRoot ? [scope] : []
    for (const host of [...hosts, ...Array.from(scope.querySelectorAll('*'))]) {
      const shadow = host.shadowRoot
      if (!shadow || found.has(shadow)) continue
      found.add(shadow)
      visit(shadow)
    }
  }
  visit(root)
  return Array.from(found)
}

export const querySelectorAllDeep = <T extends Element = HTMLElement>(
  root: Node,
  selector: string,
): T[] => {
  if (!isQueryRoot(root)) return []
  const scopes: QueryRoot[] = [root, ...openShadowRoots(root)]
  return scopes.flatMap((scope) => Array.from(scope.querySelectorAll<T>(selector)))
}

export const querySelectorDeep = <T extends Element = HTMLElement>(
  root: Node,
  selector: string,
): T | null => querySelectorAllDeep<T>(root, selector)[0] ?? null

export const composedParent = (node: Node): Node | null => {
  if (node.parentNode instanceof ShadowRoot) return node.parentNode.host
  return node.parentNode
}

export const composedContains = (container: Node, node: Node): boolean => {
  let current: Node | null = node
  while (current) {
    if (current === container) return true
    current = composedParent(current)
  }
  return false
}

export const isAttached = (node: Node): boolean =>
  node.isConnected && node.ownerDocument === document

export const rootQueryScope = (el: Element): Document | ShadowRoot => {
  const root = el.getRootNode()
  return root instanceof ShadowRoot ? root : document
}

export const getElementByIdInScope = (el: Element, id: string): HTMLElement | null => {
  const scope = rootQueryScope(el)
  const local =
    scope instanceof ShadowRoot
      ? scope.querySelector<HTMLElement>(`#${CSS.escape(id)}`)
      : scope.getElementById(id)
  return local ?? document.getElementById(id)
}

export type ShadowRootObserver = {
  sync: (root: Node) => void
  disconnect: () => void
  observedCount: () => number
}

export const createShadowRootObserver = (
  onMutation: MutationCallback,
  options: MutationObserverInit,
): ShadowRootObserver => {
  const observers = new Map<ShadowRoot, MutationObserver>()

  const sync = (root: Node): void => {
    for (const [shadow, observer] of observers) {
      if (shadow.host.isConnected) continue
      observer.disconnect()
      observers.delete(shadow)
    }
    for (const shadow of openShadowRoots(root)) {
      if (observers.has(shadow)) continue
      const observer = new MutationObserver(onMutation)
      observer.observe(shadow, options)
      observers.set(shadow, observer)
    }
  }

  const disconnect = (): void => {
    for (const observer of observers.values()) observer.disconnect()
    observers.clear()
  }

  return { disconnect, observedCount: () => observers.size, sync }
}

export const deepActiveElement = (doc: Document = document): Element | null => {
  let current: Element | null = doc.activeElement
  while (current?.shadowRoot?.activeElement) current = current.shadowRoot.activeElement
  return current
}

export const closestComposed = (start: Element, selector: string): Element | null => {
  let node: Node | null = start
  while (node) {
    if (node instanceof Element && node.matches(selector)) return node
    node = composedParent(node)
  }
  return null
}

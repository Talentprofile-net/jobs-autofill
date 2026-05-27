export const getElement = (
  context: Node | Node[],
  xpath: string,
): HTMLElement | null => {
  if (context instanceof Node) {
    return getElementFromNode(context, xpath)
  }
  if (Array.isArray(context)) {
    for (const node of context) {
      const found = getElementFromNode(node, xpath)
      if (found) return found
    }
  }
  return null
}

const getElementFromNode = (context: Node, xpath: string): HTMLElement | null => {
  const node = document.evaluate(
    xpath,
    context,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null,
  ).singleNodeValue
  return node as HTMLElement | null
}

export const getElements = (parent: Node, xpath: string): HTMLElement[] => {
  const iterator = document.evaluate(
    xpath,
    parent,
    null,
    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
    null,
  )
  const result: HTMLElement[] = []
  for (let i = 0; i < iterator.snapshotLength; i++) {
    result.push(iterator.snapshotItem(i) as HTMLElement)
  }
  return result
}

type WaitForElementOptions = {
  onlyNew?: boolean
  timeout?: number
  observeAttributes?: boolean
  attributeFilter?: string[]
}

export const waitForElement = (
  parent: Node,
  xpath: string,
  {
    onlyNew = false,
    timeout = 3000,
    observeAttributes = false,
    attributeFilter,
  }: WaitForElementOptions = {},
): Promise<HTMLElement | null> => {
  return new Promise((resolve) => {
    if (!onlyNew) {
      const initial = getElementFromNode(parent, xpath)
      if (initial) {
        return resolve(initial)
      }
    }
    const observer = new MutationObserver(() => {
      const found = getElementFromNode(parent, xpath)
      if (!found) return
      observer.disconnect()
      clearTimeout(timer)
      resolve(found)
    })
    const timer = setTimeout(() => {
      observer.disconnect()
      resolve(null)
    }, timeout)
    const observerInit: MutationObserverInit = {
      childList: true,
      subtree: true,
    }
    if (observeAttributes) {
      observerInit.attributes = true
      if (attributeFilter) observerInit.attributeFilter = attributeFilter
    }
    observer.observe(parent, observerInit)
  })
}
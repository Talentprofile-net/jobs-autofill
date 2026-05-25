export class TaskTimeoutError extends Error {
  constructor(public timeoutMs: number) {
    super(`Task timed out after ${timeoutMs}ms`)
  }
}

export const withTimeout = <T>(task: () => Promise<T>, timeoutMs: number): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new TaskTimeoutError(timeoutMs))
    }, timeoutMs)
    task().then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}
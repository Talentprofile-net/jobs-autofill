import { withTimeout, TaskTimeoutError } from './withTimeout'

const PER_TASK_TIMEOUT_MS = 15000

type Entry<T> = {
  task: () => Promise<T>
  resolve: (value: T) => void
  reject: (err: unknown) => void
}

class AsyncQueue {
  private queue: Entry<unknown>[] = []
  private running = false

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        task: task as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      })
      this.runNext()
    })
  }

  private async runNext(): Promise<void> {
    if (this.running || this.queue.length === 0) return
    this.running = true
    const next = this.queue.shift()
    if (next) {
      try {
        const value = await withTimeout(next.task, PER_TASK_TIMEOUT_MS)
        next.resolve(value)
      } catch (error) {
        if (error instanceof TaskTimeoutError) {
          console.warn('[TP] field fill task exceeded timeout', error.timeoutMs)
        } else {
          console.error('[TP] field fill task failed', error)
        }
        next.reject(error)
      }
    }
    this.running = false
    this.runNext()
  }
}

const fieldFillerQueue = new AsyncQueue()
export default fieldFillerQueue
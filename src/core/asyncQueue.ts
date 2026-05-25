import { withTimeout, TaskTimeoutError } from './withTimeout'

type Task = () => Promise<unknown>
type Entry = {
  task: Task
  resolve: () => void
  reject: (err: unknown) => void
}

const PER_TASK_TIMEOUT_MS = 15000

class AsyncQueue {
  private static instance: AsyncQueue
  private queue: Entry[] = []
  private running = false

  private constructor() {}

  public static getInstance(): AsyncQueue {
    if (!AsyncQueue.instance) {
      AsyncQueue.instance = new AsyncQueue()
    }
    return AsyncQueue.instance
  }

  public enqueue(task: Task): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ task, resolve, reject })
      this.runNext()
    })
  }

  private async runNext(): Promise<void> {
    if (this.running || this.queue.length === 0) {
      return
    }
    this.running = true
    const next = this.queue.shift()
    if (next) {
      try {
        await withTimeout(next.task, PER_TASK_TIMEOUT_MS)
        next.resolve()
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

const fieldFillerQueue = AsyncQueue.getInstance()
export default fieldFillerQueue
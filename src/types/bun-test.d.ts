// Types for the `bun:test` API these specs actually use.
//
// Bun ships its own `bun-types` package, but pulling it in is a dependency
// change this work is not allowed to make. Excluding the specs from `tsc`
// instead would be worse: it would hide every type error inside a test, which is
// exactly where a wrong assumption about a signature turns into a test that
// passes by accident.
//
// So the surface is declared here, narrowly and honestly. It covers what is
// imported and nothing else; reaching for a matcher that is not listed is a
// compile error rather than an `any`, which is the point. Widen it when a spec
// genuinely needs more, and delete it the day `bun-types` is a real dependency.
declare module 'bun:test' {
  type MaybePromise = Promise<unknown> | void

  interface Matchers {
    not: Omit<Matchers, 'not'>
    toBe(expected: unknown): void
    toBeCloseTo(expected: number, digits?: number): void
    toBeGreaterThan(expected: number): void
    toBeLessThan(expected: number): void
    toBeLessThanOrEqual(expected: number): void
    toBeNull(): void
    toContain(expected: unknown): void
    toEqual(expected: unknown): void
    toHaveLength(expected: number): void
  }

  interface EachFn<Row> {
    (label: string, fn: (...args: Row extends readonly unknown[] ? Row : [Row]) => MaybePromise): void
  }

  interface TestFn {
    (label: string, fn: () => MaybePromise, timeoutMs?: number): void
    each<Row>(cases: readonly Row[]): EachFn<Row>
    skipIf(condition: boolean): (label: string, fn: () => MaybePromise, timeoutMs?: number) => void
  }

  export const describe: (label: string, fn: () => void) => void
  export const it: TestFn
  export const test: TestFn
  // Bun's `expect` takes an optional label as its second argument, unlike jest's.
  // Declared because the specs use it, not to make an error go away.
  export const expect: (actual: unknown, label?: string) => Matchers
  export const beforeEach: (fn: () => MaybePromise) => void
  export const afterEach: (fn: () => MaybePromise) => void
  export const mock: {
    module(specifier: string, factory: () => unknown): void
  }
}

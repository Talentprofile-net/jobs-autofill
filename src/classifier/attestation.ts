import { createHash } from 'node:crypto'
import { lstat, readdir, readFile } from 'node:fs/promises'

export const CANDIDATE_SCHEMA_VERSION = 'browser-candidate.v1'
export const ATTESTATION_SCHEMA_VERSION = 'browser-attestation.v1'
export const CANDIDATE_FILE = 'browser_candidate.json'
export const ATTESTATION_FILE = 'browser_attestation.json'
export const BUILD_COMMAND = 'bun run build'
export const BUILD_DIRECTORY = '.output/chrome-mv3'
export const STAGED_FILES = [
  'model.onnx',
  'tokenizer.json',
  'labels.json',
  'selective_policy.json',
  'preprocessing.json',
] as const

export const CLASSIFIER_BUILD_FILES = [
  ...STAGED_FILES.map((name) => `classifier/${name}`),
  'classifier/model-version.json',
]

export const REQUIRED_BUILD_FILES = [
  'manifest.json',
  'background.js',
  'offscreen.html',
  'popup.html',
  'ort/ort-wasm-simd-threaded.mjs',
  'ort/ort-wasm-simd-threaded.wasm',
  ...CLASSIFIER_BUILD_FILES,
]

export const REQUIRED_CHROME_SMOKE_CHECKS = [
  'the exported client loads in an extension page',
  'the cold call answers every request',
  'decision 0 (whitespace) matches the python fixture',
  'decision 1 (spanish) matches the python fixture',
  'decision 2 (empty question) matches the python fixture',
  'the warm call repeats the same decisions',
  'two in-flight requests each get their own answer',
  'status reports the staged model version',
  'status reports a label count',
  'the client reconnects after an explicit disconnect',
  'one offscreen document is open',
  'the service worker is gone',
  'decisions are unchanged after the service worker is terminated',
  'a request survives the offscreen document closing under it',
  'closeOffscreenDocument removes the document',
  'the client reopens the document on the next call',
  'decisions survive a full reload',
] as const

export const REQUIRED_STRICT_PARITY_TESTS = [
  'policy parity > reaches the same decision as python for every fixture case',
  'policy parity > accepts the artifact preprocessing and policy contracts',
  'tokenizer parity > produces python token ids, including truncation',
] as const

export const REQUIRED_MODEL_PARITY_TESTS = [
  'model parity > matches python logits and decisions through onnxruntime-web',
] as const

export type StagedFile = (typeof STAGED_FILES)[number]
export type FileHashes = Record<StagedFile, string>
export type TreeHashes = Record<string, string>
export type SpecStatus = 'pass' | 'skip' | 'fail' | 'todo'
export type SpecResult = { name: string; status: SpecStatus }
export type SpecRun = { command: string; exitCode: number; tests: SpecResult[] }
export type SmokeCheck = { name: string; ok: boolean }
export type ExtensionSource = { commitBefore: string; commitAfter: string; clean: boolean }

export type Candidate = {
  candidateSchemaVersion: typeof CANDIDATE_SCHEMA_VERSION
  runId: string
  modelVersion: string
  createdAt: string
  variant: 'fp32' | 'int8'
  sourceModelFile: 'model.onnx' | 'model.int8.onnx'
  runtimeBundleSha256: string
  selectionSha256: string
  extensionCommit: string
  preregistrationSha256: string
  preregisteredAt: string
  files: FileHashes
}

export type AttestationInput = {
  candidate: Candidate
  candidateSha256: string
  stagedFiles: FileHashes
  stagedModelVersion: string
  fixture: { modelVersion: string; sha256: string }
  strictParity: SpecRun
  modelParity: SpecRun
  smokeChecks: SmokeCheck[]
  chromeVersion: string
  extension: ExtensionSource
  build: TreeHashes
  buildAfterSmoke: TreeHashes
  createdAt: string
}

export type Attestation = {
  attestationSchemaVersion: typeof ATTESTATION_SCHEMA_VERSION
  runId: string
  modelVersion: string
  createdAt: string
  chromeVersion: string
  extension: ExtensionSource
  artifact: {
    manifestFile: typeof CANDIDATE_FILE
    manifestSha256: string
    runtimeBundleSha256: string
    stagedFiles: FileHashes
  }
  build: {
    command: typeof BUILD_COMMAND
    directory: typeof BUILD_DIRECTORY
    treeSha256: string
    treeSha256AfterSmoke: string
    files: TreeHashes
  }
  parityFixture: { modelVersion: string; sha256: string }
  strictParity: SpecRun
  modelParity: SpecRun
  chromeSmoke: { requiredChecks: number; checks: SmokeCheck[] }
}

const SHA256 = /^[0-9a-f]{64}$/
const COMMIT = /^[0-9a-f]{40}$/
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const BUILD_PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/
const CHROME_VERSION = /^(Chrome|HeadlessChrome)\/\d+\.\d+\.\d+\.\d+$/
const SPEC_LINE = /^\((pass|fail|skip|todo)\) (.+?)(?: \[[\d.]+(?:ms|s)\])?$/

export const sha256Bytes = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex')

export const sha256File = async (path: string): Promise<string> => sha256Bytes(await readFile(path))

export async function hashFiles(directory: string): Promise<FileHashes> {
  const entries = await Promise.all(
    STAGED_FILES.map(async (name) => [name, await sha256File(`${directory}/${name}`)] as const),
  )
  return Object.fromEntries(entries) as FileHashes
}

const isBuildPath = (path: string): boolean =>
  BUILD_PATH.test(path) && path.split('/').every((part) => part !== '.' && part !== '..')

export async function hashTree(directory: string, prefix = ''): Promise<TreeHashes> {
  const hashes: TreeHashes = {}
  for (const name of (await readdir(prefix ? `${directory}/${prefix}` : directory)).sort()) {
    const path = prefix ? `${prefix}/${name}` : name
    const entry = await lstat(`${directory}/${path}`)
    if (!isBuildPath(path)) throw new Error(`build path ${JSON.stringify(path)} is outside the contract`)
    if (entry.isDirectory()) Object.assign(hashes, await hashTree(directory, path))
    else if (entry.isFile()) hashes[path] = await sha256File(`${directory}/${path}`)
    else throw new Error(`build entry ${path} is not a regular file or directory`)
  }
  return hashes
}

export const buildTreeSha256 = (files: TreeHashes): string =>
  sha256Bytes(
    Object.keys(files)
      .sort()
      .map((path) => `${path}\0${files[path]}\n`)
      .join(''),
  )

export function treeChanges(before: TreeHashes, after: TreeHashes): string[] {
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
  return paths.flatMap((path) => {
    if (!(path in after)) return [`build file removed during the run: ${path}`]
    if (!(path in before)) return [`build file added during the run: ${path}`]
    return before[path] === after[path] ? [] : [`build file changed during the run: ${path}`]
  })
}

export function parseSpecOutput(output: string): SpecResult[] {
  return output
    .split(/\r?\n/)
    .map((line) => SPEC_LINE.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ status: match[1] as SpecStatus, name: match[2] }))
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isSha256 = (value: unknown): value is string => typeof value === 'string' && SHA256.test(value)

export function readCandidate(raw: unknown): Candidate {
  if (!isRecord(raw) || raw.candidateSchemaVersion !== CANDIDATE_SCHEMA_VERSION) {
    throw new Error(`the browser candidate manifest is not ${CANDIDATE_SCHEMA_VERSION}`)
  }
  const files = raw.files
  const text = ['runId', 'modelVersion'].every((key) => typeof raw[key] === 'string' && raw[key] !== '')
  const times = [raw.createdAt, raw.preregisteredAt].every(
    (value) => typeof value === 'string' && TIMESTAMP.test(value),
  )
  const hashes =
    isRecord(files) &&
    Object.keys(files).length === STAGED_FILES.length &&
    STAGED_FILES.every((name) => isSha256(files[name]))
  const digests =
    isSha256(raw.runtimeBundleSha256) && isSha256(raw.selectionSha256) && isSha256(raw.preregistrationSha256)
  const commit = typeof raw.extensionCommit === 'string' && COMMIT.test(raw.extensionCommit)
  const variant = raw.variant === 'fp32' || raw.variant === 'int8'
  const model = raw.sourceModelFile === 'model.onnx' || raw.sourceModelFile === 'model.int8.onnx'
  if (!text || !times || !hashes || !digests || !commit || !variant || !model) {
    throw new Error('the browser candidate manifest is malformed')
  }
  return raw as Candidate
}

export function sourceProblems(candidate: Candidate, source: ExtensionSource): string[] {
  return [
    ...(source.clean ? [] : ['the extension tree has uncommitted changes; commit before attesting']),
    ...(source.commitBefore === source.commitAfter ? [] : ['the extension commit changed during the run']),
    ...(source.commitBefore === candidate.extensionCommit
      ? []
      : [`the extension is at ${source.commitBefore}, not the preregistered ${candidate.extensionCommit}`]),
  ]
}

function fileProblems(actual: FileHashes, expected: FileHashes): string[] {
  return STAGED_FILES.filter((name) => actual[name] !== expected[name]).map(
    (name) => `staged ${name} does not match the browser candidate`,
  )
}

function buildProblems(candidate: Candidate, build: TreeHashes, after: TreeHashes): string[] {
  const paths = Object.keys(build)
  return [
    ...paths.filter((path) => !isBuildPath(path)).map((path) => `build path ${path} is outside the contract`),
    ...REQUIRED_BUILD_FILES.filter((path) => !(path in build)).map((path) => `build file missing: ${path}`),
    ...paths
      .filter((path) => path.startsWith('classifier/') && !CLASSIFIER_BUILD_FILES.includes(path))
      .map((path) => `unexpected build file: ${path}`),
    ...STAGED_FILES.filter(
      (name) => `classifier/${name}` in build && build[`classifier/${name}`] !== candidate.files[name],
    ).map((name) => `stale build: classifier/${name} does not match the browser candidate`),
    ...treeChanges(build, after),
  ]
}

function specProblems(label: string, run: SpecRun, required: readonly string[]): string[] {
  const names = run.tests.map((test) => test.name)
  return [
    ...(run.exitCode === 0 ? [] : [`${label} exited with ${run.exitCode}`]),
    ...(run.tests.length > 0 ? [] : [`${label} recorded no tests`]),
    ...(new Set(names).size === names.length ? [] : [`${label} recorded a test twice`]),
    ...run.tests.filter((test) => test.status !== 'pass').map((test) => `${label} ${test.status}: ${test.name}`),
    ...required.filter((name) => !names.includes(name)).map((name) => `${label} is missing ${name}`),
  ]
}

function smokeProblems(checks: SmokeCheck[]): string[] {
  const names = checks.map((check) => check.name)
  const exact =
    names.length === REQUIRED_CHROME_SMOKE_CHECKS.length &&
    REQUIRED_CHROME_SMOKE_CHECKS.every((name, index) => names[index] === name)
  return [
    ...(exact ? [] : [`chrome smoke ran ${names.length} checks that differ from the required checks`]),
    ...checks.filter((check) => !check.ok).map((check) => `chrome smoke failed: ${check.name}`),
  ]
}

export function attestationProblems(input: AttestationInput): string[] {
  const { candidate } = input
  return [
    ...(isSha256(input.candidateSha256) ? [] : ['the candidate digest is not a sha256']),
    ...sourceProblems(candidate, input.extension),
    ...fileProblems(input.stagedFiles, candidate.files),
    ...buildProblems(candidate, input.build, input.buildAfterSmoke),
    ...(input.stagedModelVersion === candidate.modelVersion ? [] : ['the staged model version is another model']),
    ...(input.fixture.modelVersion === candidate.modelVersion ? [] : ['the parity fixture is for another model']),
    ...specProblems('strict parity', input.strictParity, REQUIRED_STRICT_PARITY_TESTS),
    ...specProblems('model parity', input.modelParity, REQUIRED_MODEL_PARITY_TESTS),
    ...smokeProblems(input.smokeChecks),
    ...(CHROME_VERSION.test(input.chromeVersion) ? [] : [`unexpected chrome version ${input.chromeVersion}`]),
  ]
}

const specRecord = ({ command, exitCode, tests }: SpecRun): SpecRun => ({
  command,
  exitCode,
  tests: tests.map(({ name, status }) => ({ name, status })),
})

export function buildAttestation(input: AttestationInput): Attestation {
  const problems = attestationProblems(input)
  if (problems.length > 0) {
    throw new Error(`no browser attestation written:\n  ${problems.join('\n  ')}`)
  }
  const { candidate } = input
  return {
    attestationSchemaVersion: ATTESTATION_SCHEMA_VERSION,
    runId: candidate.runId,
    modelVersion: candidate.modelVersion,
    createdAt: input.createdAt,
    chromeVersion: input.chromeVersion,
    extension: {
      commitBefore: input.extension.commitBefore,
      commitAfter: input.extension.commitAfter,
      clean: input.extension.clean,
    },
    artifact: {
      manifestFile: CANDIDATE_FILE,
      manifestSha256: input.candidateSha256,
      runtimeBundleSha256: candidate.runtimeBundleSha256,
      stagedFiles: input.stagedFiles,
    },
    build: {
      command: BUILD_COMMAND,
      directory: BUILD_DIRECTORY,
      treeSha256: buildTreeSha256(input.build),
      treeSha256AfterSmoke: buildTreeSha256(input.buildAfterSmoke),
      files: input.build,
    },
    parityFixture: input.fixture,
    strictParity: specRecord(input.strictParity),
    modelParity: specRecord(input.modelParity),
    chromeSmoke: {
      requiredChecks: REQUIRED_CHROME_SMOKE_CHECKS.length,
      checks: input.smokeChecks.map(({ name, ok }) => ({ name, ok })),
    },
  }
}

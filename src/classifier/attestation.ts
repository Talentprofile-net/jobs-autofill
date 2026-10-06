import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, rm } from 'node:fs/promises'

export const CANDIDATE_SCHEMA_VERSION = 'browser-candidate.v1'
export const ATTESTATION_SCHEMA_VERSION = 'browser-attestation.v1'
export const CANDIDATE_FILE = 'browser_candidate.json'
export const ATTESTATION_FILE = 'browser_attestation.json'
export const SUCCESSOR_SCHEMA_VERSION = 'browser-runtime-successor.v1'
export const SUCCESSOR_ATTESTATION_SCHEMA_VERSION = 'browser-runtime-successor-attestation.v3'
export const PRE_DEFAULT_ON_SUCCESSOR_ATTESTATION_SCHEMA_VERSION = 'browser-runtime-successor-attestation.v1'
export const PRE_WORKER_SUCCESSOR_ATTESTATION_SCHEMA_VERSION = 'browser-runtime-successor-attestation.v2'
export const SUCCESSOR_FILE = 'browser_successor.json'
export const BUILD_COMMAND = 'bun run build'
export const BUILD_DIRECTORY = '.output/chrome-mv3'
export const STAGED_FILES = [
  'model.onnx',
  'tokenizer.json',
  'labels.json',
  'selective_policy.json',
  'preprocessing.json',
] as const

export const SUCCESSOR_STAGED_FILES = [...STAGED_FILES, 'model-version.json'] as const

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

export const REQUIRED_SUGGEST_SMOKE_CHECKS = [
  'the service worker was stopped during the cold load',
  'a suggestion survives the service worker stopping during the cold model load',
  'the service worker was stopped during the picker cold load',
  'a fresh profile stores no suggestion preference',
  'with no stored preference the classifier runs by default and stores nothing',
  'an explicit false switch stays off after the service worker restarts',
  'an invalid stored switch value answers disabled',
  'an invalid stored switch value never starts the classifier',
  'the deliberate close runs from the background service worker',
  'a deliberate close rejects the in-flight background request promptly',
  'the picker stays responsive while uncached saved answers are classified',
] as const

export const RECOGNITION_SPEC = 'src/adapters/genericRecognition.spec.ts'

export type StagedFile = (typeof STAGED_FILES)[number]
export type FileHashes = Record<StagedFile, string>
export type SuccessorFile = (typeof SUCCESSOR_STAGED_FILES)[number]
export type SuccessorHashes = Record<SuccessorFile, string>
export type TreeHashes = Record<string, string>
export type SpecStatus = 'pass' | 'skip' | 'fail' | 'todo'
export type SpecResult = { name: string; status: SpecStatus }
export type SpecRun = { command: string; exitCode: number; tests: SpecResult[] }
export type SmokeCheck = { name: string; ok: boolean }
export type ExtensionSource = { commitBefore: string; commitAfter: string; clean: boolean }
export type SmokeRun = { command: string; exitCode: number; chromeVersion: string; checks: SmokeCheck[] }

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

export type Successor = {
  successorSchemaVersion: typeof SUCCESSOR_SCHEMA_VERSION
  runId: string
  modelVersion: string
  createdAt: string
  variant: 'fp32' | 'int8'
  sourceModelFile: 'model.onnx' | 'model.int8.onnx'
  runtimeBundleSha256: string
  selectionSha256: string
  artifactManifestSha256: string
  artifactManifestSchemaVersion: string
  approvalBlockers: string[]
  finalTest: {
    ledgerFile: string
    ledgerSha256: string
    ledgerSchemaVersion: 'final-test-ledger.v2' | 'final-test-ledger.v3'
    testSetSha256: string
    index: number
    status: 'final'
    preregistrationSha256: string
    governanceVerified: true
  }
  extensionCommit: string
  files: SuccessorHashes
}

export type SuccessorAttestationInput = {
  successor: Successor
  successorSha256: string
  stagedFiles: SuccessorHashes
  fixture: { modelVersion: string; sha256: string }
  strictParity: SpecRun
  modelParity: SpecRun
  recognition: SpecRun
  chromeSmoke: SmokeRun
  suggestSmoke: SmokeRun
  extension: ExtensionSource
  build: TreeHashes
  buildAfterSmoke: TreeHashes
  attestor: TreeHashes
  createdAt: string
}

export type SuccessorAttestation = {
  attestationSchemaVersion: typeof SUCCESSOR_ATTESTATION_SCHEMA_VERSION
  runId: string
  modelVersion: string
  createdAt: string
  chromeVersion: string
  extension: ExtensionSource
  artifact: {
    manifestFile: typeof SUCCESSOR_FILE
    manifestSha256: string
    artifactManifestSha256: string
    runtimeBundleSha256: string
    stagedFiles: SuccessorHashes
  }
  build: Attestation['build']
  parityFixture: { modelVersion: string; sha256: string }
  strictParity: SpecRun
  modelParity: SpecRun
  chromeSmoke: SmokeRun
  suggestSmoke: SmokeRun
  recognition: SpecRun
  attestor: { files: TreeHashes }
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
const SMOKE_LINE = /^(ok {2}|FAIL) (.+)$/
const SMOKE_CHROME = /^chrome ((?:Headless)?Chrome\/\d+\.\d+\.\d+\.\d+)$/m

export const sha256Bytes = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex')

export const sha256File = async (path: string): Promise<string> => sha256Bytes(await readFile(path))

export async function hashNamedFiles<Name extends string>(
  directory: string,
  names: readonly Name[],
): Promise<Record<Name, string>> {
  const entries = await Promise.all(
    names.map(async (name) => [name, await sha256File(`${directory}/${name}`)] as const),
  )
  return Object.fromEntries(entries) as Record<Name, string>
}

export const hashFiles = (directory: string): Promise<FileHashes> => hashNamedFiles(directory, STAGED_FILES)

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

export function parseSmokeOutput(output: string): { chromeVersion: string; checks: SmokeCheck[] } {
  const checks = output
    .split(/\r?\n/)
    .map((line) => SMOKE_LINE.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ name: match[2], ok: match[1] !== 'FAIL' }))
  return { chromeVersion: SMOKE_CHROME.exec(output)?.[1] ?? 'unknown', checks }
}

export async function runCommand(
  cwd: string,
  command: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<{ exitCode: number; output: string }> {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (output += chunk))
  const exitCode = await new Promise<number>((done) => child.on('close', (code) => done(code ?? 1)))
  return { exitCode, output }
}

export async function runSpec(cwd: string, file: string, env: Record<string, string> = {}): Promise<SpecRun> {
  const { exitCode, output } = await runCommand(cwd, 'bun', ['test', `./${file}`], env)
  const tests = parseSpecOutput(output)
  const flags = Object.entries(env).map(([key, value]) => `${key}=${value}`)
  console.log(
    `${file}: exit ${exitCode}, ${tests.filter((test) => test.status === 'pass').length}/${tests.length} pass`,
  )
  return { command: [...flags, 'bun', 'test', `./${file}`].join(' '), exitCode, tests }
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

export function readSuccessor(raw: unknown): Successor {
  if (!isRecord(raw) || raw.successorSchemaVersion !== SUCCESSOR_SCHEMA_VERSION) {
    throw new Error(`the runtime successor manifest is not ${SUCCESSOR_SCHEMA_VERSION}`)
  }
  const { files, finalTest } = raw
  const text = ['runId', 'modelVersion', 'artifactManifestSchemaVersion'].every(
    (key) => typeof raw[key] === 'string' && raw[key] !== '',
  )
  const time = typeof raw.createdAt === 'string' && TIMESTAMP.test(raw.createdAt)
  const hashes =
    isRecord(files) &&
    Object.keys(files).length === SUCCESSOR_STAGED_FILES.length &&
    SUCCESSOR_STAGED_FILES.every((name) => isSha256(files[name]))
  const digests = [raw.runtimeBundleSha256, raw.selectionSha256, raw.artifactManifestSha256].every(isSha256)
  const commit = typeof raw.extensionCommit === 'string' && COMMIT.test(raw.extensionCommit)
  const variant = raw.variant === 'fp32' || raw.variant === 'int8'
  const model = raw.sourceModelFile === 'model.onnx' || raw.sourceModelFile === 'model.int8.onnx'
  const blockers = Array.isArray(raw.approvalBlockers) && raw.approvalBlockers.every((item) => typeof item === 'string')
  const final =
    isRecord(finalTest) &&
    finalTest.status === 'final' &&
    finalTest.governanceVerified === true &&
    Number.isInteger(finalTest.index) &&
    (finalTest.ledgerSchemaVersion === 'final-test-ledger.v2' ||
      finalTest.ledgerSchemaVersion === 'final-test-ledger.v3') &&
    typeof finalTest.ledgerFile === 'string' &&
    [finalTest.ledgerSha256, finalTest.testSetSha256, finalTest.preregistrationSha256].every(isSha256)
  if (!text || !time || !hashes || !digests || !commit || !variant || !model || !blockers || !final) {
    throw new Error('the runtime successor manifest is malformed')
  }
  return raw as Successor
}

export function sourceProblems(
  subject: { extensionCommit: string },
  source: ExtensionSource,
  label = 'preregistered',
): string[] {
  return [
    ...(source.clean ? [] : ['the extension tree has uncommitted changes; commit before attesting']),
    ...(source.commitBefore === source.commitAfter ? [] : ['the extension commit changed during the run']),
    ...(source.commitBefore === subject.extensionCommit
      ? []
      : [`the extension is at ${source.commitBefore}, not the ${label} ${subject.extensionCommit}`]),
  ]
}

export function fileProblems<Name extends string>(
  actual: Record<Name, string>,
  expected: Record<Name, string>,
  names: readonly Name[],
  subject: string,
): string[] {
  return names
    .filter((name) => actual[name] !== expected[name])
    .map((name) => `staged ${name} does not match the ${subject}`)
}

function buildProblems<Name extends string>(
  files: Record<Name, string>,
  names: readonly Name[],
  subject: string,
  build: TreeHashes,
  after: TreeHashes,
): string[] {
  const paths = Object.keys(build)
  return [
    ...paths.filter((path) => !isBuildPath(path)).map((path) => `build path ${path} is outside the contract`),
    ...REQUIRED_BUILD_FILES.filter((path) => !(path in build)).map((path) => `build file missing: ${path}`),
    ...paths
      .filter((path) => path.startsWith('classifier/') && !CLASSIFIER_BUILD_FILES.includes(path))
      .map((path) => `unexpected build file: ${path}`),
    ...names
      .filter((name) => `classifier/${name}` in build && build[`classifier/${name}`] !== files[name])
      .map((name) => `stale build: classifier/${name} does not match the ${subject}`),
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

export const successorAttestationVersionProblems = (version: unknown): string[] => {
  if (version === SUCCESSOR_ATTESTATION_SCHEMA_VERSION) return []
  if (version === PRE_DEFAULT_ON_SUCCESSOR_ATTESTATION_SCHEMA_VERSION) {
    return [
      `the attestation is ${PRE_DEFAULT_ON_SUCCESSOR_ATTESTATION_SCHEMA_VERSION}, which predates the default-on suggestion checks; attest the runtime successor again to write ${SUCCESSOR_ATTESTATION_SCHEMA_VERSION}`,
    ]
  }
  if (version === PRE_WORKER_SUCCESSOR_ATTESTATION_SCHEMA_VERSION) {
    return [
      `the attestation is ${PRE_WORKER_SUCCESSOR_ATTESTATION_SCHEMA_VERSION}, which predates worker isolation and the picker-responsiveness checks; attest the runtime successor again to write ${SUCCESSOR_ATTESTATION_SCHEMA_VERSION}`,
    ]
  }
  return [`the attestation is not ${SUCCESSOR_ATTESTATION_SCHEMA_VERSION}`]
}

function suggestSmokeProblems(smoke: SmokeRun): string[] {
  const names = new Set(smoke.checks.map((check) => check.name))
  return [
    ...(smoke.exitCode === 0 ? [] : [`suggestion smoke exited with ${smoke.exitCode}`]),
    ...(smoke.checks.length > 0 ? [] : ['suggestion smoke recorded no checks']),
    ...smoke.checks.filter((check) => !check.ok).map((check) => `suggestion smoke failed: ${check.name}`),
    ...REQUIRED_SUGGEST_SMOKE_CHECKS.filter((name) => !names.has(name)).map(
      (name) => `suggestion smoke is missing ${name}`,
    ),
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
    ...fileProblems(input.stagedFiles, candidate.files, STAGED_FILES, 'browser candidate'),
    ...buildProblems(candidate.files, STAGED_FILES, 'browser candidate', input.build, input.buildAfterSmoke),
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

export function successorAttestationProblems(input: SuccessorAttestationInput): string[] {
  const { successor, chromeSmoke, suggestSmoke } = input
  const subject = 'runtime successor'
  const versions = new Set([chromeSmoke.chromeVersion, suggestSmoke.chromeVersion])
  return [
    ...(isSha256(input.successorSha256) ? [] : ['the runtime successor digest is not a sha256']),
    ...sourceProblems(successor, input.extension, subject),
    ...fileProblems(input.stagedFiles, successor.files, SUCCESSOR_STAGED_FILES, subject),
    ...buildProblems(successor.files, SUCCESSOR_STAGED_FILES, subject, input.build, input.buildAfterSmoke),
    ...(input.fixture.modelVersion === successor.modelVersion ? [] : ['the parity fixture is for another model']),
    ...specProblems('strict parity', input.strictParity, REQUIRED_STRICT_PARITY_TESTS),
    ...specProblems('model parity', input.modelParity, REQUIRED_MODEL_PARITY_TESTS),
    ...specProblems('generic recognition', input.recognition, []),
    ...(input.recognition.command.includes(RECOGNITION_SPEC)
      ? []
      : [`generic recognition did not run ${RECOGNITION_SPEC}`]),
    ...(chromeSmoke.exitCode === 0 ? [] : [`chrome smoke exited with ${chromeSmoke.exitCode}`]),
    ...smokeProblems(chromeSmoke.checks),
    ...suggestSmokeProblems(suggestSmoke),
    ...(CHROME_VERSION.test(chromeSmoke.chromeVersion)
      ? []
      : [`unexpected chrome version ${chromeSmoke.chromeVersion}`]),
    ...(versions.size === 1 ? [] : ['the smoke tests ran in different Chrome versions']),
    ...(Object.keys(input.attestor).length > 0 && Object.values(input.attestor).every(isSha256)
      ? []
      : ['the attestor files are not recorded']),
  ]
}

const smokeRecord = ({ command, exitCode, chromeVersion, checks }: SmokeRun): SmokeRun => ({
  command,
  exitCode,
  chromeVersion,
  checks: checks.map(({ name, ok }) => ({ name, ok })),
})

export function buildSuccessorAttestation(input: SuccessorAttestationInput): SuccessorAttestation {
  const problems = successorAttestationProblems(input)
  if (problems.length > 0) {
    throw new Error(`no browser attestation written:\n  ${problems.join('\n  ')}`)
  }
  const { successor } = input
  return {
    attestationSchemaVersion: SUCCESSOR_ATTESTATION_SCHEMA_VERSION,
    runId: successor.runId,
    modelVersion: successor.modelVersion,
    createdAt: input.createdAt,
    chromeVersion: input.chromeSmoke.chromeVersion,
    extension: {
      commitBefore: input.extension.commitBefore,
      commitAfter: input.extension.commitAfter,
      clean: input.extension.clean,
    },
    artifact: {
      manifestFile: SUCCESSOR_FILE,
      manifestSha256: input.successorSha256,
      artifactManifestSha256: successor.artifactManifestSha256,
      runtimeBundleSha256: successor.runtimeBundleSha256,
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
    chromeSmoke: smokeRecord(input.chromeSmoke),
    suggestSmoke: smokeRecord(input.suggestSmoke),
    recognition: specRecord(input.recognition),
    attestor: { files: input.attestor },
  }
}

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

export const RELEASE_FILE = 'release.json'
const RELEASE_ZIP = /^talentprofile-autofill-.+-chrome\.zip$/
const PARTIAL = /\.partial-\d+/
const TRAINING_FILES = ['manifest.json', CANDIDATE_FILE, 'run.json']
export const TEXT_FILE = /\.(c?js|mjs|html|css|json|txt|svg|md)$/
const SOURCE_MAP = /\.map$/
const SOURCE_MAP_COMMENT = /sourceMappingURL=/
const TEST_FILE = /(^|\/)(__tests__|__fixtures__|__mocks__)\/|\.(spec|test|cy)\.[cm]?[jt]sx?$/
const SCRATCH_FILE = /(^|\/)(\.DS_Store|Thumbs\.db|\.env[^/]*)$|\.(log|tmp|swp|bak|orig|rej)$|~$|\.partial-/
const LOCAL_HOST = /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/
const PLAIN_HTTP = /"http:\/\//
const DEVELOPMENT_PERMISSIONS = ['debugger', 'management', 'nativeMessaging', 'declarativeNetRequestFeedback']
const SECRETS: [string, RegExp][] = [
  ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['an AWS access key', /AKIA[0-9A-Z]{16}/],
  ['a GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36}|\bgithub_pat_[A-Za-z0-9_]{40,}/],
  ['a Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['an API secret key', /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}|\bsk-[A-Za-z0-9_-]{32,}/],
  ['a JSON web token', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['a secret variable name', /BACKEND_API_SECRET|WXT_EXTENSION_KEY/],
]

export type ReleaseContent = {
  files: TreeHashes
  manifest: unknown
  texts: Record<string, string>
  staged: SuccessorHashes
}

export function treeDifferences(expected: TreeHashes, actual: TreeHashes): string[] {
  const paths = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()
  return paths.flatMap((path) => {
    if (!(path in actual)) return [`${path} is missing`]
    if (!(path in expected)) return [`${path} is not in the attested build`]
    return expected[path] === actual[path] ? [] : [`${path} differs from the attested build`]
  })
}

function iconPaths(manifest: Record<string, unknown>): string[] {
  const action = isRecord(manifest.action) ? manifest.action.default_icon : undefined
  return [manifest.icons, action].flatMap((icons) =>
    isRecord(icons) ? Object.values(icons).filter((path): path is string => typeof path === 'string') : [],
  )
}

function manifestProblems(manifest: unknown, files: TreeHashes): string[] {
  if (!isRecord(manifest)) return ['manifest.json is not a JSON object']
  const text = JSON.stringify(manifest)
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : []
  const icons = iconPaths(manifest)
  return [
    ...(manifest.manifest_version === 3 ? [] : ['manifest.json is not manifest version 3']),
    ...('key' in manifest ? ['manifest.json carries a development key'] : []),
    ...(LOCAL_HOST.test(text) ? ['manifest.json names a local host'] : []),
    ...(PLAIN_HTTP.test(text) ? ['manifest.json allows plain http'] : []),
    ...DEVELOPMENT_PERMISSIONS.filter((name) => permissions.includes(name)).map(
      (name) => `manifest.json requests the development permission ${name}`,
    ),
    ...(icons.length > 0 ? [] : ['manifest.json declares no icons']),
    ...icons.filter((path) => !(path.replace(/^\//, '') in files)).map((path) => `icon missing: ${path}`),
  ]
}

export function releaseContentProblems({ files, manifest, texts, staged }: ReleaseContent): string[] {
  const paths = Object.keys(files).sort()
  return [
    ...manifestProblems(manifest, files),
    ...REQUIRED_BUILD_FILES.filter((path) => !(path in files)).map((path) => `release file missing: ${path}`),
    ...paths
      .filter((path) => path.startsWith('classifier/') && !CLASSIFIER_BUILD_FILES.includes(path))
      .map((path) => `stale classifier file: ${path}`),
    ...SUCCESSOR_STAGED_FILES.filter((name) => files[`classifier/${name}`] !== staged[name]).map(
      (name) => `classifier/${name} is not the attested classifier asset`,
    ),
    ...paths.filter((path) => SOURCE_MAP.test(path)).map((path) => `source map: ${path}`),
    ...paths.filter((path) => TEST_FILE.test(path)).map((path) => `test file: ${path}`),
    ...paths.filter((path) => SCRATCH_FILE.test(path)).map((path) => `scratch or log file: ${path}`),
    ...Object.entries(texts)
      .filter(([, text]) => SOURCE_MAP_COMMENT.test(text))
      .map(([path]) => `source map reference: ${path}`),
    ...Object.entries(texts).flatMap(([path, text]) =>
      SECRETS.filter(([, pattern]) => pattern.test(text)).map(([name]) => `${path} contains ${name}`),
    ),
  ]
}

export async function clearReleaseOutputs(directory: string, withAttestation: boolean): Promise<string[]> {
  const names = await readdir(directory).catch(() => [])
  const foreign = names.filter((name) => TRAINING_FILES.includes(name))
  if (foreign.length > 0)
    throw new Error(`${directory} holds training files (${foreign.join(', ')}); not a release directory`)
  const stale = names.filter(
    (name) =>
      name === RELEASE_FILE ||
      RELEASE_ZIP.test(name) ||
      PARTIAL.test(name) ||
      (withAttestation && name === ATTESTATION_FILE),
  )
  await Promise.all(stale.map((name) => rm(`${directory}/${name}`, { force: true })))
  return stale.sort()
}

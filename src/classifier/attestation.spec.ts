import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ATTESTATION_SCHEMA_VERSION,
  PRE_DEFAULT_ON_SUCCESSOR_ATTESTATION_SCHEMA_VERSION,
  RECOGNITION_SPEC,
  REQUIRED_BUILD_FILES,
  REQUIRED_CHROME_SMOKE_CHECKS,
  REQUIRED_MODEL_PARITY_TESTS,
  REQUIRED_STRICT_PARITY_TESTS,
  REQUIRED_SUGGEST_SMOKE_CHECKS,
  STAGED_FILES,
  SUCCESSOR_ATTESTATION_SCHEMA_VERSION,
  SUCCESSOR_STAGED_FILES,
  buildAttestation,
  buildSuccessorAttestation,
  buildTreeSha256,
  hashTree,
  parseSmokeOutput,
  parseSpecOutput,
  readCandidate,
  readSuccessor,
  sourceProblems,
  successorAttestationVersionProblems,
  treeChanges,
  type AttestationInput,
  type Candidate,
  type FileHashes,
  type Successor,
  type SuccessorAttestationInput,
  type SuccessorHashes,
  type TreeHashes,
} from '~/classifier/attestation'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'
const OTHER = 'fedcba9876543210fedcba9876543210fedcba98'

const hashes = (digit: string): FileHashes =>
  Object.fromEntries(STAGED_FILES.map((name, index) => [name, `${digit}${index}`.padEnd(64, digit)])) as FileHashes

const candidate: Candidate = {
  candidateSchemaVersion: 'browser-candidate.v1',
  runId: '7b3d8ac2dcc0465a',
  modelVersion: 'candidate-7b3d8ac2dcc0465a-5a3ca45d058b-77de3656539f',
  createdAt: '2026-09-23T10:00:00.000Z',
  variant: 'fp32',
  sourceModelFile: 'model.onnx',
  runtimeBundleSha256: '1'.repeat(64),
  selectionSha256: '2'.repeat(64),
  extensionCommit: COMMIT,
  preregistrationSha256: '5'.repeat(64),
  preregisteredAt: '2026-09-10T00:00:00.000Z',
  files: hashes('a'),
}

const build = (): TreeHashes => ({
  ...Object.fromEntries(REQUIRED_BUILD_FILES.map((path) => [path, 'b'.repeat(64)])),
  ...Object.fromEntries(STAGED_FILES.map((name) => [`classifier/${name}`, candidate.files[name]])),
  'chunks/offscreen-Ci2ki7D0.js': 'c'.repeat(64),
})

const passing = (names: readonly string[]) => names.map((name) => ({ name, status: 'pass' as const }))

const valid = (): AttestationInput => ({
  candidate,
  candidateSha256: '3'.repeat(64),
  stagedFiles: hashes('a'),
  stagedModelVersion: candidate.modelVersion,
  fixture: { modelVersion: candidate.modelVersion, sha256: '4'.repeat(64) },
  strictParity: { command: 'bun test', exitCode: 0, tests: passing(REQUIRED_STRICT_PARITY_TESTS) },
  modelParity: { command: 'bun test', exitCode: 0, tests: passing(REQUIRED_MODEL_PARITY_TESTS) },
  smokeChecks: REQUIRED_CHROME_SMOKE_CHECKS.map((name) => ({ name, ok: true })),
  chromeVersion: 'Chrome/143.0.7499.40',
  extension: { commitBefore: COMMIT, commitAfter: COMMIT, clean: true },
  build: build(),
  buildAfterSmoke: build(),
  createdAt: '2026-09-23T11:00:00.000Z',
})

const failure = (run: () => unknown): string => {
  try {
    run()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return ''
}

const without = (files: TreeHashes, path: string): TreeHashes =>
  Object.fromEntries(Object.entries(files).filter(([key]) => key !== path))

describe('browser attestation', () => {
  it('records every required check and the build tree for the exact candidate', () => {
    const attestation = buildAttestation(valid())
    expect(attestation.attestationSchemaVersion).toBe(ATTESTATION_SCHEMA_VERSION)
    expect(attestation.chromeSmoke.requiredChecks).toBe(17)
    expect(attestation.chromeSmoke.checks).toHaveLength(17)
    expect(attestation.artifact.stagedFiles).toEqual(candidate.files)
    expect(attestation.extension).toEqual({ commitBefore: COMMIT, commitAfter: COMMIT, clean: true })
    expect(attestation.build.command).toBe('bun run build')
    expect(attestation.build.directory).toBe('.output/chrome-mv3')
    expect(attestation.build.treeSha256).toBe(buildTreeSha256(build()))
    expect(attestation.build.treeSha256AfterSmoke).toBe(attestation.build.treeSha256)
    expect(Object.keys(attestation)).not.toContain('passed')
  })

  it('records only the contract fields of each check', () => {
    const checks = valid().smokeChecks.map((check) => ({ ...check, detail: 'extra' }))
    const attestation = buildAttestation({ ...valid(), smokeChecks: checks })
    expect(attestation.chromeSmoke.checks.every((check) => Object.keys(check).join() === 'name,ok')).toBe(true)
  })

  const cases: [string, (input: AttestationInput) => AttestationInput, string][] = [
    ['the tree is dirty', (i) => ({ ...i, extension: { ...i.extension, clean: false } }), 'uncommitted changes'],
    [
      'the commit changes during the run',
      (i) => ({ ...i, extension: { ...i.extension, commitAfter: OTHER } }),
      'commit changed during the run',
    ],
    [
      'the commit is not the preregistered one',
      (i) => ({ ...i, extension: { commitBefore: OTHER, commitAfter: OTHER, clean: true } }),
      'not the preregistered',
    ],
    [
      'a staged file differs',
      (i) => ({ ...i, stagedFiles: { ...i.stagedFiles, 'model.onnx': 'f'.repeat(64) } }),
      'staged model.onnx',
    ],
    [
      'the build carries stale classifier assets',
      (i) => ({
        ...i,
        build: { ...i.build, 'classifier/labels.json': 'f'.repeat(64) },
        buildAfterSmoke: { ...i.buildAfterSmoke, 'classifier/labels.json': 'f'.repeat(64) },
      }),
      'stale build: classifier/labels.json',
    ],
    [
      'a required build file is missing',
      (i) => ({ ...i, build: without(i.build, 'background.js'), buildAfterSmoke: without(i.build, 'background.js') }),
      'build file missing: background.js',
    ],
    [
      'an extra classifier file is built',
      (i) => ({
        ...i,
        build: { ...i.build, 'classifier/model.int8.onnx': 'e'.repeat(64) },
        buildAfterSmoke: { ...i.buildAfterSmoke, 'classifier/model.int8.onnx': 'e'.repeat(64) },
      }),
      'unexpected build file: classifier/model.int8.onnx',
    ],
    [
      'a build file changes during smoke',
      (i) => ({ ...i, buildAfterSmoke: { ...i.buildAfterSmoke, 'background.js': 'e'.repeat(64) } }),
      'build file changed during the run: background.js',
    ],
    [
      'a build file appears during smoke',
      (i) => ({ ...i, buildAfterSmoke: { ...i.buildAfterSmoke, 'extra.js': 'e'.repeat(64) } }),
      'build file added during the run: extra.js',
    ],
    [
      'a build file disappears during smoke',
      (i) => ({ ...i, buildAfterSmoke: without(i.buildAfterSmoke, 'popup.html') }),
      'build file removed during the run: popup.html',
    ],
    ['the staged model version differs', (i) => ({ ...i, stagedModelVersion: 'other' }), 'staged model version'],
    [
      'the fixture is for another model',
      (i) => ({ ...i, fixture: { ...i.fixture, modelVersion: 'other' } }),
      'parity fixture',
    ],
    [
      'strict parity failed',
      (i) => ({ ...i, strictParity: { ...i.strictParity, exitCode: 1 } }),
      'strict parity exited with 1',
    ],
    [
      'strict parity ran nothing',
      (i) => ({ ...i, strictParity: { ...i.strictParity, tests: [] } }),
      'strict parity recorded no tests',
    ],
    [
      'strict parity skipped a test',
      (i) => ({
        ...i,
        strictParity: {
          ...i.strictParity,
          tests: [
            ...passing(REQUIRED_STRICT_PARITY_TESTS.slice(1)),
            { name: REQUIRED_STRICT_PARITY_TESTS[0], status: 'skip' },
          ],
        },
      }),
      'strict parity skip',
    ],
    [
      'strict parity missed a required test',
      (i) => ({ ...i, strictParity: { ...i.strictParity, tests: passing(REQUIRED_STRICT_PARITY_TESTS.slice(1)) } }),
      'strict parity is missing',
    ],
    [
      'model parity was skipped',
      (i) => ({
        ...i,
        modelParity: { ...i.modelParity, tests: [{ name: REQUIRED_MODEL_PARITY_TESTS[0], status: 'skip' }] },
      }),
      'model parity skip',
    ],
    [
      'a test is recorded twice',
      (i) => ({
        ...i,
        modelParity: {
          ...i.modelParity,
          tests: passing([...REQUIRED_MODEL_PARITY_TESTS, ...REQUIRED_MODEL_PARITY_TESTS]),
        },
      }),
      'recorded a test twice',
    ],
    ['the smoke stopped early', (i) => ({ ...i, smokeChecks: i.smokeChecks.slice(0, 16) }), 'ran 16 checks'],
    [
      'a smoke check failed',
      (i) => ({ ...i, smokeChecks: i.smokeChecks.map((check, index) => ({ ...check, ok: index !== 3 })) }),
      'chrome smoke failed: decision 1',
    ],
    [
      'a smoke check was renamed',
      (i) => ({ ...i, smokeChecks: [{ name: 'renamed', ok: true }, ...i.smokeChecks.slice(1)] }),
      'differ from the required checks',
    ],
    ['the chrome version is unknown', (i) => ({ ...i, chromeVersion: 'unknown' }), 'unexpected chrome version'],
    ['the candidate digest is missing', (i) => ({ ...i, candidateSha256: '' }), 'candidate digest'],
  ]

  for (const [name, change, message] of cases) {
    it(`writes nothing when ${name}`, () => {
      expect(failure(() => buildAttestation(change(valid())))).toContain(message)
    })
  }
})

describe('extension source', () => {
  it('accepts only the clean preregistered commit', () => {
    expect(sourceProblems(candidate, { commitBefore: COMMIT, commitAfter: COMMIT, clean: true })).toEqual([])
    expect(sourceProblems(candidate, { commitBefore: COMMIT, commitAfter: COMMIT, clean: false })).toHaveLength(1)
    expect(sourceProblems(candidate, { commitBefore: OTHER, commitAfter: OTHER, clean: true })).toHaveLength(1)
  })
})

describe('build tree', () => {
  it('hashes ordered path and digest lines the way the trainer does', () => {
    const files = { 'b.js': '2'.repeat(64), 'a/c.json': '1'.repeat(64) }
    expect(buildTreeSha256(files)).toBe('fa9e81059a38f2aab68966f6b214d701b86aacf499c9ff75f813b8853616c988')
  })

  it('hashes every regular file under the build directory and sees changes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tp-tree-'))
    try {
      mkdirSync(join(directory, 'classifier'))
      writeFileSync(join(directory, 'manifest.json'), '{}')
      writeFileSync(join(directory, 'classifier/model.onnx'), 'model')
      const before = await hashTree(directory)
      expect(Object.keys(before)).toEqual(['classifier/model.onnx', 'manifest.json'])

      writeFileSync(join(directory, 'classifier/model.onnx'), 'other model')
      writeFileSync(join(directory, 'extra.js'), 'x')
      rmSync(join(directory, 'manifest.json'))
      expect(treeChanges(before, await hashTree(directory))).toEqual([
        'build file changed during the run: classifier/model.onnx',
        'build file added during the run: extra.js',
        'build file removed during the run: manifest.json',
      ])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('refuses symlinks and paths outside the contract', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tp-tree-'))
    try {
      writeFileSync(join(directory, 'real.js'), 'x')
      symlinkSync(join(directory, 'real.js'), join(directory, 'link.js'))
      expect(await hashTree(directory).catch((error: Error) => error.message)).toContain('not a regular file')
      rmSync(join(directory, 'link.js'))
      writeFileSync(join(directory, 'bad name.js'), 'x')
      expect(await hashTree(directory).catch((error: Error) => error.message)).toContain('outside the contract')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('spec output parsing', () => {
  it('reads bun result lines with and without timings', () => {
    const output = [
      'src/classifier/parity.spec.ts:',
      '(pass) policy parity > reaches the same decision [0.57ms]',
      '(skip) tokenizer parity > produces python token ids, including truncation',
      '(fail) model parity > matches [12000.10ms]',
      '(todo) later',
      ' 1 pass',
    ].join('\n')
    expect(parseSpecOutput(output)).toEqual([
      { status: 'pass', name: 'policy parity > reaches the same decision' },
      { status: 'skip', name: 'tokenizer parity > produces python token ids, including truncation' },
      { status: 'fail', name: 'model parity > matches' },
      { status: 'todo', name: 'later' },
    ])
  })
})

describe('browser candidate manifest', () => {
  it('accepts a complete candidate', () => {
    expect(readCandidate(JSON.parse(JSON.stringify(candidate)))).toEqual(candidate)
  })

  const broken: [string, unknown][] = [
    ['null', null],
    ['another version', { ...candidate, candidateSchemaVersion: 'browser-candidate.v0' }],
    ['a missing file', { ...candidate, files: { ...candidate.files, 'labels.json': undefined } }],
    ['an extra file', { ...candidate, files: { ...candidate.files, 'model.int8.onnx': '1'.repeat(64) } }],
    ['a short hash', { ...candidate, runtimeBundleSha256: 'abc' }],
    ['an unknown variant', { ...candidate, variant: 'int4' }],
    ['an unknown model file', { ...candidate, sourceModelFile: 'model.pt' }],
    ['an empty model version', { ...candidate, modelVersion: '' }],
    ['no preregistered commit', { ...candidate, extensionCommit: undefined }],
    ['a short commit', { ...candidate, extensionCommit: '0123456' }],
    ['no preregistration digest', { ...candidate, preregistrationSha256: 'x' }],
    ['a malformed preregistration time', { ...candidate, preregisteredAt: '2026-09-10' }],
  ]

  for (const [name, raw] of broken) {
    it(`rejects ${name}`, () => {
      expect(failure(() => readCandidate(raw))).toContain('browser candidate manifest')
    })
  }
})

const successorHashes = (digit: string): SuccessorHashes =>
  Object.fromEntries(
    SUCCESSOR_STAGED_FILES.map((name, index) => [name, `${digit}${index}`.padEnd(64, digit)]),
  ) as SuccessorHashes

const successor: Successor = {
  successorSchemaVersion: 'browser-runtime-successor.v1',
  runId: candidate.runId,
  modelVersion: candidate.modelVersion,
  createdAt: '2026-10-02T15:00:00.000Z',
  variant: 'fp32',
  sourceModelFile: 'model.onnx',
  runtimeBundleSha256: '1'.repeat(64),
  selectionSha256: '2'.repeat(64),
  artifactManifestSha256: '6'.repeat(64),
  artifactManifestSchemaVersion: 'autofill-classifier-manifest.v8',
  approvalBlockers: ['browser_runtime_unverified'],
  finalTest: {
    ledgerFile: `${'7'.repeat(64)}.json`,
    ledgerSha256: '8'.repeat(64),
    ledgerSchemaVersion: 'final-test-ledger.v2',
    testSetSha256: '7'.repeat(64),
    index: 0,
    status: 'final',
    preregistrationSha256: '5'.repeat(64),
    governanceVerified: true,
  },
  extensionCommit: COMMIT,
  files: successorHashes('a'),
}

const successorBuild = (): TreeHashes => ({
  ...Object.fromEntries(REQUIRED_BUILD_FILES.map((path) => [path, 'b'.repeat(64)])),
  ...Object.fromEntries(SUCCESSOR_STAGED_FILES.map((name) => [`classifier/${name}`, successor.files[name]])),
  'chunks/offscreen-Ci2ki7D0.js': 'c'.repeat(64),
})

const smokeRun = (names: readonly string[], command: string) => ({
  command,
  exitCode: 0,
  chromeVersion: 'HeadlessChrome/143.0.7499.40',
  checks: names.map((name) => ({ name, ok: true })),
})

const validSuccessor = (): SuccessorAttestationInput => ({
  successor,
  successorSha256: '3'.repeat(64),
  stagedFiles: successorHashes('a'),
  fixture: { modelVersion: successor.modelVersion, sha256: '4'.repeat(64) },
  strictParity: { command: 'bun test', exitCode: 0, tests: passing(REQUIRED_STRICT_PARITY_TESTS) },
  modelParity: { command: 'bun test', exitCode: 0, tests: passing(REQUIRED_MODEL_PARITY_TESTS) },
  recognition: {
    command: `bun test ./${RECOGNITION_SPEC}`,
    exitCode: 0,
    tests: passing(['recognizes a field']),
  },
  chromeSmoke: smokeRun(REQUIRED_CHROME_SMOKE_CHECKS, 'node scripts/chrome-smoke.mjs'),
  suggestSmoke: smokeRun(
    ['an explicit false switch answers disabled', ...REQUIRED_SUGGEST_SMOKE_CHECKS],
    'node scripts/chrome-suggest-smoke.mjs',
  ),
  extension: { commitBefore: COMMIT, commitAfter: COMMIT, clean: true },
  build: successorBuild(),
  buildAfterSmoke: successorBuild(),
  attestor: { 'scripts/attest-runtime-successor.mjs': '9'.repeat(64) },
  createdAt: '2026-10-02T16:00:00.000Z',
})

describe('runtime successor attestation', () => {
  it('records the exact successor, all six classifier files, both smokes and the build', () => {
    const attestation = buildSuccessorAttestation(validSuccessor())
    expect(attestation.attestationSchemaVersion).toBe('browser-runtime-successor-attestation.v2')
    expect(attestation.artifact.manifestFile).toBe('browser_successor.json')
    expect(attestation.artifact.artifactManifestSha256).toBe(successor.artifactManifestSha256)
    expect(Object.keys(attestation.artifact.stagedFiles)).toEqual([...SUCCESSOR_STAGED_FILES])
    expect(attestation.chromeVersion).toBe('HeadlessChrome/143.0.7499.40')
    expect(attestation.chromeSmoke.checks).toHaveLength(17)
    expect(REQUIRED_SUGGEST_SMOKE_CHECKS).toHaveLength(8)
    expect(attestation.suggestSmoke.checks).toHaveLength(9)
    expect(attestation.build.treeSha256).toBe(buildTreeSha256(successorBuild()))
    expect(attestation.attestor.files).toEqual(validSuccessor().attestor)
  })

  const cases: [string, (input: SuccessorAttestationInput) => SuccessorAttestationInput, string][] = [
    ['the tree is dirty', (i) => ({ ...i, extension: { ...i.extension, clean: false } }), 'uncommitted changes'],
    [
      'the commit is not the successor commit',
      (i) => ({ ...i, extension: { commitBefore: OTHER, commitAfter: OTHER, clean: true } }),
      `not the runtime successor ${COMMIT}`,
    ],
    [
      'the commit changes during the run',
      (i) => ({ ...i, extension: { ...i.extension, commitAfter: OTHER } }),
      'commit changed during the run',
    ],
    ...SUCCESSOR_STAGED_FILES.map(
      (name): [string, (input: SuccessorAttestationInput) => SuccessorAttestationInput, string] => [
        `staged ${name} differs`,
        (i) => ({ ...i, stagedFiles: { ...i.stagedFiles, [name]: 'f'.repeat(64) } }),
        `staged ${name} does not match the runtime successor`,
      ],
    ),
    [
      'the build carries another model version file',
      (i) => ({
        ...i,
        build: { ...i.build, 'classifier/model-version.json': 'f'.repeat(64) },
        buildAfterSmoke: {
          ...i.buildAfterSmoke,
          'classifier/model-version.json': 'f'.repeat(64),
        },
      }),
      'stale build: classifier/model-version.json does not match the runtime successor',
    ],
    [
      'a build file changes during the run',
      (i) => ({
        ...i,
        buildAfterSmoke: { ...i.buildAfterSmoke, 'background.js': 'e'.repeat(64) },
      }),
      'build file changed during the run: background.js',
    ],
    [
      'strict parity skipped a test',
      (i) => ({
        ...i,
        strictParity: {
          ...i.strictParity,
          tests: [
            ...passing(REQUIRED_STRICT_PARITY_TESTS.slice(1)),
            { name: REQUIRED_STRICT_PARITY_TESTS[0], status: 'skip' },
          ],
        },
      }),
      'strict parity skip',
    ],
    [
      'model parity was skipped',
      (i) => ({
        ...i,
        modelParity: {
          ...i.modelParity,
          tests: [{ name: REQUIRED_MODEL_PARITY_TESTS[0], status: 'skip' }],
        },
      }),
      'model parity skip',
    ],
    [
      'recognition ran another spec',
      (i) => ({
        ...i,
        recognition: { ...i.recognition, command: 'bun test ./src/core/match.spec.ts' },
      }),
      `did not run ${RECOGNITION_SPEC}`,
    ],
    [
      'recognition skipped a test',
      (i) => ({
        ...i,
        recognition: {
          ...i.recognition,
          tests: [{ name: 'recognizes a field', status: 'skip' }],
        },
      }),
      'generic recognition skip',
    ],
    [
      'the chrome smoke exited non-zero',
      (i) => ({ ...i, chromeSmoke: { ...i.chromeSmoke, exitCode: 1 } }),
      'chrome smoke exited with 1',
    ],
    [
      'the chrome smoke stopped early',
      (i) => ({
        ...i,
        chromeSmoke: { ...i.chromeSmoke, checks: i.chromeSmoke.checks.slice(0, 12) },
      }),
      'ran 12 checks',
    ],
    [
      'a suggestion check failed',
      (i) => ({
        ...i,
        suggestSmoke: {
          ...i.suggestSmoke,
          checks: i.suggestSmoke.checks.map((check) => ({ ...check, ok: false })),
        },
      }),
      'suggestion smoke failed: an explicit false switch answers disabled',
    ],
    ...REQUIRED_SUGGEST_SMOKE_CHECKS.map(
      (required): [string, (input: SuccessorAttestationInput) => SuccessorAttestationInput, string] => [
        `the suggestion check "${required}" is missing`,
        (i) => ({
          ...i,
          suggestSmoke: {
            ...i.suggestSmoke,
            checks: i.suggestSmoke.checks.filter((check) => check.name !== required),
          },
        }),
        `suggestion smoke is missing ${required}`,
      ],
    ),
    [
      'the suggestion smoke exited non-zero',
      (i) => ({ ...i, suggestSmoke: { ...i.suggestSmoke, exitCode: 1 } }),
      'suggestion smoke exited with 1',
    ],
    [
      'the smokes ran in different Chrome versions',
      (i) => ({
        ...i,
        suggestSmoke: { ...i.suggestSmoke, chromeVersion: 'HeadlessChrome/144.0.0.1' },
      }),
      'different Chrome versions',
    ],
    [
      'the chrome version is unknown',
      (i) => ({
        ...i,
        chromeSmoke: { ...i.chromeSmoke, chromeVersion: 'unknown' },
        suggestSmoke: { ...i.suggestSmoke, chromeVersion: 'unknown' },
      }),
      'unexpected chrome version',
    ],
    ['the attestor is unrecorded', (i) => ({ ...i, attestor: {} }), 'attestor files'],
  ]

  for (const [name, change, message] of cases) {
    it(`writes nothing when ${name}`, () => {
      expect(failure(() => buildSuccessorAttestation(change(validSuccessor())))).toContain(message)
    })
  }

  it('accepts only the v2 successor attestation and refuses v1 as older than the default-on checks', () => {
    expect(successorAttestationVersionProblems(SUCCESSOR_ATTESTATION_SCHEMA_VERSION)).toEqual([])
    expect(successorAttestationVersionProblems(PRE_DEFAULT_ON_SUCCESSOR_ATTESTATION_SCHEMA_VERSION)).toEqual([
      'the attestation is browser-runtime-successor-attestation.v1, which predates the default-on suggestion checks; attest the runtime successor again to write browser-runtime-successor-attestation.v2',
    ])
    expect(successorAttestationVersionProblems('browser-attestation.v1')).toEqual([
      'the attestation is not browser-runtime-successor-attestation.v2',
    ])
    expect(successorAttestationVersionProblems(undefined)).toEqual([
      'the attestation is not browser-runtime-successor-attestation.v2',
    ])
  })

  it('keeps the preregistered candidate wording and schema', () => {
    expect(buildAttestation(valid()).attestationSchemaVersion).toBe(ATTESTATION_SCHEMA_VERSION)
    expect(ATTESTATION_SCHEMA_VERSION).toBe('browser-attestation.v1')
    expect(sourceProblems(candidate, { commitBefore: OTHER, commitAfter: OTHER, clean: true })).toEqual([
      `the extension is at ${OTHER}, not the preregistered ${COMMIT}`,
    ])
  })
})

describe('runtime successor manifest', () => {
  it('accepts a complete successor', () => {
    expect(readSuccessor(JSON.parse(JSON.stringify(successor)))).toEqual(successor)
  })

  const broken: [string, unknown][] = [
    ['a browser candidate', candidate],
    ['five staged files', { ...successor, files: { ...successor.files, 'model-version.json': undefined } }],
    ['an exploratory final test', { ...successor, finalTest: { ...successor.finalTest, status: 'exploratory' } }],
    ['unverified governance', { ...successor, finalTest: { ...successor.finalTest, governanceVerified: false } }],
    ['an unknown ledger', { ...successor, finalTest: { ...successor.finalTest, ledgerSchemaVersion: 'v9' } }],
    ['no artifact manifest digest', { ...successor, artifactManifestSha256: 'x' }],
    ['a short commit', { ...successor, extensionCommit: 'fffae63' }],
    ['a malformed time', { ...successor, createdAt: '2026-10-02' }],
  ]

  for (const [name, raw] of broken) {
    it(`rejects ${name}`, () => {
      expect(failure(() => readSuccessor(raw))).toContain('runtime successor manifest')
    })
  }
})

describe('smoke output parsing', () => {
  it('reads check lines and the chrome version', () => {
    const output = [
      'chrome HeadlessChrome/143.0.7499.40',
      'extension abc',
      'ok   the cold call answers every request',
      'FAIL the warm call repeats the same decisions',
      'ok  not a check line',
      'chrome smoke passed: 2 checks',
    ].join('\n')
    expect(parseSmokeOutput(output)).toEqual({
      chromeVersion: 'HeadlessChrome/143.0.7499.40',
      checks: [
        { name: 'the cold call answers every request', ok: true },
        { name: 'the warm call repeats the same decisions', ok: false },
      ],
    })
    expect(parseSmokeOutput('nothing').chromeVersion).toBe('unknown')
  })
})

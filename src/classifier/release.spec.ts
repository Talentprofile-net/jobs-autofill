import { describe, expect, it } from 'bun:test'

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import {
  ATTESTATION_FILE,
  REQUIRED_BUILD_FILES,
  SUCCESSOR_ATTESTATION_SCHEMA_VERSION,
  SUCCESSOR_FILE,
  SUCCESSOR_STAGED_FILES,
  buildTreeSha256,
  clearReleaseOutputs,
  hashTree,
  releaseContentProblems,
  runCommand,
  sha256Bytes,
  treeDifferences,
  type ReleaseContent,
  type SuccessorHashes,
  type TreeHashes,
} from '~/classifier/attestation'

const staged = Object.fromEntries(
  SUCCESSOR_STAGED_FILES.map((name, index) => [name, `a${index}`.padEnd(64, 'a')]),
) as SuccessorHashes

const files = (): TreeHashes => ({
  ...Object.fromEntries(REQUIRED_BUILD_FILES.map((path) => [path, 'b'.repeat(64)])),
  ...Object.fromEntries(SUCCESSOR_STAGED_FILES.map((name) => [`classifier/${name}`, staged[name]])),
  'icon/16.png': 'c'.repeat(64),
  'icon/128.png': 'c'.repeat(64),
})

const manifest = {
  manifest_version: 3,
  name: 'TalentProfile Autofill',
  version: '0.1.0',
  permissions: ['storage', 'tabs', 'webNavigation', 'scripting', 'offscreen'],
  host_permissions: ['https://*.talentprofile.net/*'],
  icons: { '16': 'icon/16.png', '128': 'icon/128.png' },
}

const valid = (): ReleaseContent => ({
  files: files(),
  manifest,
  texts: { 'background.js': 'console.log(1)', 'manifest.json': JSON.stringify(manifest) },
  staged,
})

describe('release zip content', () => {
  it('accepts the attested production build', () => {
    expect(releaseContentProblems(valid())).toEqual([])
  })

  const cases: [string, (input: ReleaseContent) => ReleaseContent, string][] = [
    ['manifest version 2', (i) => ({ ...i, manifest: { ...manifest, manifest_version: 2 } }), 'not manifest version 3'],
    ['a development key', (i) => ({ ...i, manifest: { ...manifest, key: 'MIIB' } }), 'development key'],
    [
      'a localhost host permission',
      (i) => ({ ...i, manifest: { ...manifest, host_permissions: ['http://localhost:8083/*'] } }),
      'names a local host',
    ],
    [
      'a plain http match',
      (i) => ({ ...i, manifest: { ...manifest, host_permissions: ['http://example.com/*'] } }),
      'allows plain http',
    ],
    [
      'a development permission',
      (i) => ({
        ...i,
        manifest: { ...manifest, permissions: [...manifest.permissions, 'debugger'] },
      }),
      'development permission debugger',
    ],
    ['no icons', (i) => ({ ...i, manifest: { ...manifest, icons: {} } }), 'declares no icons'],
    [
      'a missing icon file',
      (i) => ({
        ...i,
        files: Object.fromEntries(Object.entries(i.files).filter(([path]) => path !== 'icon/128.png')),
      }),
      'icon missing: icon/128.png',
    ],
    [
      'missing wasm',
      (i) => ({
        ...i,
        files: Object.fromEntries(
          Object.entries(i.files).filter(([path]) => path !== 'ort/ort-wasm-simd-threaded.wasm'),
        ),
      }),
      'release file missing: ort/ort-wasm-simd-threaded.wasm',
    ],
    [
      'a stale classifier asset',
      (i) => ({ ...i, files: { ...i.files, 'classifier/model.int8.onnx': 'd'.repeat(64) } }),
      'stale classifier file: classifier/model.int8.onnx',
    ],
    ...SUCCESSOR_STAGED_FILES.map((name): [string, (input: ReleaseContent) => ReleaseContent, string] => [
      `another ${name}`,
      (i) => ({ ...i, files: { ...i.files, [`classifier/${name}`]: 'd'.repeat(64) } }),
      `classifier/${name} is not the attested classifier asset`,
    ]),
    [
      'a source map',
      (i) => ({ ...i, files: { ...i.files, 'background.js.map': 'd'.repeat(64) } }),
      'source map: background.js.map',
    ],
    [
      'a source map reference',
      (i) => ({
        ...i,
        texts: { ...i.texts, 'background.js': '//# sourceMappingURL=background.js.map' },
      }),
      'source map reference: background.js',
    ],
    [
      'a test file',
      (i) => ({ ...i, files: { ...i.files, 'chunks/match.spec.js': 'd'.repeat(64) } }),
      'test file: chunks/match.spec.js',
    ],
    [
      'a fixture',
      (i) => ({ ...i, files: { ...i.files, '__fixtures__/parity.json': 'd'.repeat(64) } }),
      'test file: __fixtures__/parity.json',
    ],
    ['a log', (i) => ({ ...i, files: { ...i.files, 'build.log': 'd'.repeat(64) } }), 'scratch or log file: build.log'],
    [
      'a .DS_Store',
      (i) => ({ ...i, files: { ...i.files, 'icon/.DS_Store': 'd'.repeat(64) } }),
      'scratch or log file: icon/.DS_Store',
    ],
    [
      'an env file',
      (i) => ({ ...i, files: { ...i.files, '.env.local': 'd'.repeat(64) } }),
      'scratch or log file: .env.local',
    ],
    [
      'a private key',
      (i) => ({ ...i, texts: { ...i.texts, 'popup.js': '-----BEGIN RSA PRIVATE KEY-----' } }),
      'popup.js contains a private key',
    ],
    [
      'a secret variable name',
      (i) => ({ ...i, texts: { ...i.texts, 'background.js': 'process.env.BACKEND_API_SECRET' } }),
      'background.js contains a secret variable name',
    ],
    [
      'an API key',
      (i) => ({ ...i, texts: { ...i.texts, 'background.js': `const k = "sk-${'A'.repeat(40)}"` } }),
      'background.js contains an API secret key',
    ],
  ]

  for (const [name, change, message] of cases) {
    it(`refuses ${name}`, () => {
      expect(releaseContentProblems(change(valid())).join('\n')).toContain(message)
    })
  }
})

describe('build drift', () => {
  it('reports every file that differs from the attested build', () => {
    const attested = { 'a.js': '1'.repeat(64), 'b.js': '2'.repeat(64), 'c.js': '3'.repeat(64) }
    const current = { 'a.js': '1'.repeat(64), 'b.js': '9'.repeat(64), 'd.js': '4'.repeat(64) }
    expect(treeDifferences(attested, attested)).toEqual([])
    expect(treeDifferences(attested, current)).toEqual([
      'b.js differs from the attested build',
      'c.js is missing',
      'd.js is not in the attested build',
    ])
  })
})

const STALE = [
  ATTESTATION_FILE,
  'release.json',
  'talentprofile-autofill-0.1.0-chrome.zip',
  'talentprofile-autofill-0.0.9-chrome.zip',
  'talentprofile-autofill-0.1.0-chrome.partial-123.zip',
  'browser_attestation.json.partial-456',
]

const plantStale = (directory: string) => {
  mkdirSync(directory, { recursive: true })
  for (const name of STALE) writeFileSync(join(directory, name), 'stale')
  writeFileSync(join(directory, 'notes.txt'), 'kept')
}

const listing = (directory: string) => readdirSync(directory).sort()

describe('stale release outputs', () => {
  it('removes the attestation, release metadata, release zips and partial files', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tp-stale-'))
    try {
      plantStale(directory)
      writeFileSync(join(directory, SUCCESSOR_FILE), '{}')
      expect(await clearReleaseOutputs(directory, false)).toEqual(
        STALE.filter((name) => name !== ATTESTATION_FILE).sort(),
      )
      expect(listing(directory)).toEqual([ATTESTATION_FILE, SUCCESSOR_FILE, 'notes.txt'])
      expect(await clearReleaseOutputs(directory, true)).toEqual([ATTESTATION_FILE])
      expect(listing(directory)).toEqual([SUCCESSOR_FILE, 'notes.txt'])
      expect(await clearReleaseOutputs(join(directory, 'missing'), true)).toEqual([])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('refuses a directory that holds training artifact files', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tp-stale-'))
    try {
      writeFileSync(join(directory, 'manifest.json'), '{}')
      writeFileSync(join(directory, ATTESTATION_FILE), 'legacy')
      expect(await clearReleaseOutputs(directory, true).catch((error: Error) => error.message)).toContain(
        'not a release directory',
      )
      expect(readFileSync(join(directory, ATTESTATION_FILE), 'utf8')).toBe('legacy')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

const root = resolve(import.meta.dirname, '../..')
const git = (cwd: string, ...rest: string[]) =>
  execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...rest], {
    encoding: 'utf8',
  }).trim()

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'tp-release-script-'))
  const checkout = join(base, 'checkout')
  const release = join(base, 'release')
  mkdirSync(checkout)
  git(checkout, 'init', '-q')
  writeFileSync(join(checkout, 'README.md'), 'x')
  git(checkout, 'add', 'README.md')
  git(checkout, 'commit', '-q', '-m', 'init')
  writeFileSync(join(checkout, '.git/info/exclude'), '.output\n')
  const contents: Record<string, string> = {
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'TalentProfile Autofill',
      version: '0.1.0',
      permissions: ['storage'],
      icons: { '128': 'icon/128.png' },
    }),
    'icon/128.png': 'png',
    ...Object.fromEntries(
      REQUIRED_BUILD_FILES.filter((path) => path !== 'manifest.json').map((path) => [path, `content of ${path}`]),
    ),
  }
  for (const [path, text] of Object.entries(contents)) {
    const target = join(checkout, '.output/chrome-mv3', path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, text)
  }
  const files = Object.fromEntries(Object.entries(contents).map(([path, text]) => [path, sha256Bytes(text)]))
  const staged = Object.fromEntries(
    SUCCESSOR_STAGED_FILES.map((name) => [name, files[`classifier/${name}`]]),
  ) as SuccessorHashes
  const commit = git(checkout, 'rev-parse', 'HEAD')
  const successor = JSON.stringify({
    successorSchemaVersion: 'browser-runtime-successor.v1',
    runId: '7b3d8ac2dcc0465a',
    modelVersion: 'candidate-7b3d8ac2dcc0465a-5a3ca45d058b-77de3656539f',
    createdAt: '2026-10-02T15:00:00.000Z',
    variant: 'fp32',
    sourceModelFile: 'model.onnx',
    runtimeBundleSha256: '1'.repeat(64),
    selectionSha256: '2'.repeat(64),
    artifactManifestSha256: '3'.repeat(64),
    artifactManifestSchemaVersion: 'autofill-classifier-manifest.v8',
    approvalBlockers: [],
    finalTest: {
      ledgerFile: `${'4'.repeat(64)}.json`,
      ledgerSha256: '5'.repeat(64),
      ledgerSchemaVersion: 'final-test-ledger.v2',
      testSetSha256: '4'.repeat(64),
      index: 0,
      status: 'final',
      preregistrationSha256: '6'.repeat(64),
      governanceVerified: true,
    },
    extensionCommit: commit,
    files: staged,
  })
  const attestation = JSON.stringify({
    attestationSchemaVersion: SUCCESSOR_ATTESTATION_SCHEMA_VERSION,
    artifact: { manifestSha256: sha256Bytes(successor), stagedFiles: staged },
    extension: { commitBefore: commit, commitAfter: commit, clean: true },
    build: { files, treeSha256: buildTreeSha256(files) },
  })
  plantStale(release)
  writeFileSync(join(release, SUCCESSOR_FILE), successor)
  writeFileSync(join(release, ATTESTATION_FILE), attestation)
  return { base, checkout, release }
}

const script = (name: string, checkout: string, release: string) =>
  runCommand(root, 'node', [`scripts/${name}`, '--extension-dir', checkout, release])

describe('release-package.mjs', () => {
  it('replaces every stale output with one verified zip and its metadata', async () => {
    const { base, checkout, release } = fixture()
    try {
      const { exitCode, output } = await script('release-package.mjs', checkout, release)
      expect(exitCode, output).toBe(0)
      expect(listing(release)).toEqual(
        [
          ATTESTATION_FILE,
          SUCCESSOR_FILE,
          'notes.txt',
          'release.json',
          'talentprofile-autofill-0.1.0-chrome.zip',
        ].sort(),
      )
      const metadata = JSON.parse(readFileSync(join(release, 'release.json'), 'utf8'))
      expect(metadata.zipSha256).toBe(sha256Bytes(readFileSync(join(release, metadata.zipFile))))
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('leaves no stale or partial output when the build changed after attestation', async () => {
    const { base, checkout, release } = fixture()
    try {
      writeFileSync(join(checkout, '.output/chrome-mv3/popup.html'), 'changed')
      const { exitCode, output } = await script('release-package.mjs', checkout, release)
      expect(exitCode).toBe(1)
      expect(output).toContain('build changed after attestation: popup.html differs from the attested build')
      expect(listing(release)).toEqual([ATTESTATION_FILE, SUCCESSOR_FILE, 'notes.txt'])
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('refuses a v1 attestation because it predates the default-on suggestion checks', async () => {
    const { base, checkout, release } = fixture()
    try {
      const attestation = JSON.parse(readFileSync(join(release, ATTESTATION_FILE), 'utf8'))
      attestation.attestationSchemaVersion = 'browser-runtime-successor-attestation.v1'
      writeFileSync(join(release, ATTESTATION_FILE), JSON.stringify(attestation))
      const { exitCode, output } = await script('release-package.mjs', checkout, release)
      expect(exitCode).toBe(1)
      expect(output).toContain('which predates the default-on suggestion checks')
      expect(listing(release)).toEqual([ATTESTATION_FILE, SUCCESSOR_FILE, 'notes.txt'])
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('leaves no stale or partial output when the zip content check fails', async () => {
    const { base, checkout, release } = fixture()
    try {
      const attestation = JSON.parse(readFileSync(join(release, ATTESTATION_FILE), 'utf8'))
      attestation.artifact.stagedFiles['model.onnx'] = 'f'.repeat(64)
      writeFileSync(join(release, ATTESTATION_FILE), JSON.stringify(attestation))
      const { exitCode, output } = await script('release-package.mjs', checkout, release)
      expect(exitCode).toBe(1)
      expect(output).toContain('classifier/model.onnx is not the attested classifier asset')
      expect(listing(release)).toEqual([ATTESTATION_FILE, SUCCESSOR_FILE, 'notes.txt'])
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})

describe('attest-runtime-successor.mjs', () => {
  it('removes the stale attestation, metadata and zips before refusing a dirty checkout', async () => {
    const { base, checkout, release } = fixture()
    try {
      writeFileSync(join(checkout, 'scratch.txt'), 'x')
      const { exitCode, output } = await script('attest-runtime-successor.mjs', checkout, release)
      expect(exitCode).toBe(1)
      expect(output).toContain('uncommitted changes')
      expect(listing(release)).toEqual([SUCCESSOR_FILE, 'notes.txt'])
      expect(existsSync(join(checkout, '.output/chrome-mv3/manifest.json'))).toBe(true)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('removes stale outputs even when the successor manifest is missing', async () => {
    const { base, checkout, release } = fixture()
    try {
      rmSync(join(release, SUCCESSOR_FILE))
      const { exitCode } = await script('attest-runtime-successor.mjs', checkout, release)
      expect(exitCode).not.toBe(0)
      expect(listing(release)).toEqual(['notes.txt'])
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('refuses before deleting anything in a training artifact directory', async () => {
    const { base, checkout, release } = fixture()
    try {
      writeFileSync(join(release, 'manifest.json'), '{}')
      const { exitCode, output } = await script('attest-runtime-successor.mjs', checkout, release)
      expect(exitCode).not.toBe(0)
      expect(output).toContain('not a release directory')
      expect(listing(release)).toContain(ATTESTATION_FILE)
      expect('manifest.json' in (await hashTree(join(checkout, '.output/chrome-mv3')))).toBe(true)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})

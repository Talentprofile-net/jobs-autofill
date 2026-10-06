import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  ATTESTATION_FILE,
  BUILD_DIRECTORY,
  RELEASE_FILE,
  SUCCESSOR_FILE,
  TEXT_FILE,
  buildTreeSha256,
  clearReleaseOutputs,
  hashTree,
  readSuccessor,
  releaseContentProblems,
  runCommand,
  sha256Bytes,
  sha256File,
  sourceProblems,
  successorAttestationVersionProblems,
  treeDifferences,
} from '../src/classifier/attestation.ts'

const args = process.argv.slice(2)
const dirFlag = args.indexOf('--extension-dir')
const positional = args.filter((_, index) => dirFlag === -1 || (index !== dirFlag && index !== dirFlag + 1))
if (positional.length !== 1 || (dirFlag !== -1 && !args[dirFlag + 1])) {
  console.error('usage: node scripts/release-package.mjs [--extension-dir <dir>] <successor-dir>')
  process.exit(2)
}

const successorDir = resolve(positional[0])
const cleared = await clearReleaseOutputs(successorDir, false)
if (cleared.length > 0) console.log(`removed stale release outputs: ${cleared.join(', ')}`)

const target = realpathSync(resolve(dirFlag === -1 ? resolve(import.meta.dirname, '..') : args[dirFlag + 1]))
const extension = resolve(target, BUILD_DIRECTORY)
const git = (...rest) => execFileSync('git', ['-C', target, ...rest], { encoding: 'utf8' }).trim()

function refuse(problems) {
  console.error(`no release zip written:\n  ${problems.join('\n  ')}`)
  process.exit(1)
}

const successorBytes = await readFile(resolve(successorDir, SUCCESSOR_FILE))
const successor = readSuccessor(JSON.parse(successorBytes.toString('utf8')))
const attestationBytes = await readFile(resolve(successorDir, ATTESTATION_FILE))
const attestation = JSON.parse(attestationBytes.toString('utf8'))
const attested = attestation?.build?.files ?? {}
const commit = git('rev-parse', 'HEAD')
const clean = git('status', '--porcelain', '--untracked-files=all') === ''
const current = await hashTree(extension)

const gate = [
  ...successorAttestationVersionProblems(attestation?.attestationSchemaVersion),
  ...(attestation?.artifact?.manifestSha256 === sha256Bytes(successorBytes)
    ? []
    : ['the attestation was written for another runtime successor manifest']),
  ...(attestation?.extension?.commitBefore === successor.extensionCommit && attestation?.extension?.clean === true
    ? []
    : ['the attestation does not cover the clean runtime successor commit']),
  ...(buildTreeSha256(attested) === attestation?.build?.treeSha256
    ? []
    : ['the attested build digest is inconsistent']),
  ...sourceProblems(successor, { commitBefore: commit, commitAfter: commit, clean }, 'attested'),
  ...treeDifferences(attested, current).map((difference) => `build changed after attestation: ${difference}`),
]
if (gate.length > 0) refuse(gate)

const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'))
const zipPath = resolve(successorDir, `talentprofile-autofill-${manifest.version}-chrome.zip`)
const partialPath = zipPath.replace(/\.zip$/, `.partial-${process.pid}.zip`)
const zipped = await runCommand(extension, 'zip', ['-X', '-D', '-q', partialPath, ...Object.keys(attested).sort()])
if (zipped.exitCode !== 0) {
  await rm(partialPath, { force: true })
  refuse([`zip exited with ${zipped.exitCode}: ${zipped.output.trim()}`])
}

const unpacked = await mkdtemp(join(tmpdir(), 'tp-release-'))
let problems
try {
  const unzipped = await runCommand(unpacked, 'unzip', ['-q', partialPath])
  if (unzipped.exitCode !== 0) throw new Error(`unzip exited with ${unzipped.exitCode}: ${unzipped.output.trim()}`)
  const files = await hashTree(unpacked)
  const texts = Object.fromEntries(
    await Promise.all(
      Object.keys(files)
        .filter((path) => TEXT_FILE.test(path))
        .map(async (path) => [path, await readFile(join(unpacked, path), 'utf8')]),
    ),
  )
  problems = [
    ...treeDifferences(attested, files).map((difference) => `release zip: ${difference}`),
    ...releaseContentProblems({
      files,
      manifest: JSON.parse(texts['manifest.json'] ?? 'null'),
      texts,
      staged: attestation.artifact.stagedFiles,
    }),
  ]
} catch (error) {
  problems = [error.message]
} finally {
  await rm(unpacked, { recursive: true, force: true })
}
if (problems.length > 0) {
  await rm(partialPath, { force: true })
  refuse(problems)
}
await rename(partialPath, zipPath)

const release = {
  zipFile: zipPath.split('/').pop(),
  zipSha256: await sha256File(zipPath),
  zipBytes: (await stat(zipPath)).size,
  entries: Object.keys(attested).length,
  extensionVersion: manifest.version,
  extensionCommit: successor.extensionCommit,
  modelVersion: successor.modelVersion,
  attestationSha256: sha256Bytes(attestationBytes),
  buildTreeSha256: attestation.build.treeSha256,
  createdAt: new Date().toISOString(),
}
await writeFile(resolve(successorDir, RELEASE_FILE), `${JSON.stringify(release, null, 2)}\n`)
console.log(JSON.stringify({ zip: zipPath, ...release }, null, 2))

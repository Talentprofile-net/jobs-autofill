import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  ATTESTATION_FILE,
  BUILD_COMMAND,
  BUILD_DIRECTORY,
  RECOGNITION_SPEC,
  SUCCESSOR_FILE,
  SUCCESSOR_STAGED_FILES,
  buildSuccessorAttestation,
  clearReleaseOutputs,
  fileProblems,
  hashNamedFiles,
  hashTree,
  parseSmokeOutput,
  readSuccessor,
  runCommand,
  runSpec,
  sha256Bytes,
  sha256File,
  sourceProblems,
} from '../src/classifier/attestation.ts'

const ATTESTOR_FILES = ['scripts/attest-runtime-successor.mjs', 'src/classifier/attestation.ts']
const SMOKES = { chrome: 'scripts/chrome-smoke.mjs', suggest: 'scripts/chrome-suggest-smoke.mjs' }

const args = process.argv.slice(2)
const dirFlag = args.indexOf('--extension-dir')
const positional = args.filter((_, index) => dirFlag === -1 || (index !== dirFlag && index !== dirFlag + 1))
if (positional.length !== 1 || (dirFlag !== -1 && !args[dirFlag + 1])) {
  console.error('usage: node scripts/attest-runtime-successor.mjs [--extension-dir <dir>] <successor-dir>')
  process.exit(2)
}

const successorDir = resolve(positional[0])
const cleared = await clearReleaseOutputs(successorDir, true)
if (cleared.length > 0) console.log(`removed stale release outputs: ${cleared.join(', ')}`)

const tool = resolve(import.meta.dirname, '..')
const target = realpathSync(resolve(dirFlag === -1 ? tool : args[dirFlag + 1]))
const extension = resolve(target, BUILD_DIRECTORY)
const subject = 'runtime successor'

const git = (...rest) => execFileSync('git', ['-C', target, ...rest], { encoding: 'utf8' }).trim()
const source = () => ({
  commit: git('rev-parse', 'HEAD'),
  clean: git('status', '--porcelain', '--untracked-files=all') === '',
})

function refuse(problems) {
  console.error(`no browser attestation written:\n  ${problems.join('\n  ')}`)
  process.exit(1)
}

async function runSmoke(script) {
  console.log(`running ${script} in ${target}`)
  const { exitCode, output } = await runCommand(target, 'node', [script])
  process.stdout.write(output)
  return { command: `node ${script}`, exitCode, ...parseSmokeOutput(output) }
}

const successorBytes = await readFile(resolve(successorDir, SUCCESSOR_FILE))
const successor = readSuccessor(JSON.parse(successorBytes.toString('utf8')))

if (realpathSync(git('rev-parse', '--show-toplevel')) !== target) {
  refuse([`${target} is not the top level of a git checkout`])
}
const before = source()
const stagedFiles = await hashNamedFiles(resolve(target, 'public/classifier'), SUCCESSOR_STAGED_FILES).catch(
  (error) => error,
)
const early = [
  ...sourceProblems(
    successor,
    { commitBefore: before.commit, commitAfter: before.commit, clean: before.clean },
    subject,
  ),
  ...(stagedFiles instanceof Error
    ? [`the staged classifier files cannot be read: ${stagedFiles.message}`]
    : fileProblems(stagedFiles, successor.files, SUCCESSOR_STAGED_FILES, subject)),
]
if (early.length > 0) refuse(early)

await rm(extension, { recursive: true, force: true })
const [command, ...rest] = BUILD_COMMAND.split(' ')
const built = await runCommand(target, command, rest)
if (built.exitCode !== 0) {
  process.stdout.write(built.output)
  refuse([`${BUILD_COMMAND} exited with ${built.exitCode}`])
}
const build = await hashTree(extension)
const fixtureBytes = await readFile(resolve(target, 'src/classifier/__fixtures__/parity.json'))
const strictParity = await runSpec(target, 'src/classifier/parity.spec.ts', {
  CLASSIFIER_STRICT_PARITY: '1',
})
const modelParity = await runSpec(target, 'src/classifier/model-parity.spec.ts', {
  CLASSIFIER_MODEL_PARITY: '1',
})
const recognition = await runSpec(target, RECOGNITION_SPEC)
const chromeSmoke = await runSmoke(SMOKES.chrome)
const suggestSmoke = await runSmoke(SMOKES.suggest)
const after = source()
const attestor = Object.fromEntries(
  await Promise.all(ATTESTOR_FILES.map(async (path) => [path, await sha256File(resolve(tool, path))])),
)

let attestation
try {
  attestation = buildSuccessorAttestation({
    successor,
    successorSha256: sha256Bytes(successorBytes),
    stagedFiles: await hashNamedFiles(resolve(target, 'public/classifier'), SUCCESSOR_STAGED_FILES),
    fixture: {
      modelVersion: JSON.parse(fixtureBytes.toString('utf8')).modelVersion,
      sha256: sha256Bytes(fixtureBytes),
    },
    strictParity,
    modelParity,
    recognition,
    chromeSmoke,
    suggestSmoke,
    extension: {
      commitBefore: before.commit,
      commitAfter: after.commit,
      clean: before.clean && after.clean,
    },
    build,
    buildAfterSmoke: await hashTree(extension),
    attestor,
    createdAt: new Date().toISOString(),
  })
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
const destination = resolve(successorDir, ATTESTATION_FILE)
const partial = `${destination}.partial-${process.pid}`
await writeFile(partial, `${JSON.stringify(attestation, null, 2)}\n`)
await rename(partial, destination)
console.log(`browser attestation written: ${destination} (build tree ${attestation.build.treeSha256})`)

import { cp, mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import { CANDIDATE_FILE, STAGED_FILES, hashFiles, readCandidate } from '../src/classifier/attestation.ts'

const ORT_FILES = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']

const artifact = process.argv[2]
if (!artifact) {
  console.error('usage: node scripts/stage-classifier-assets.mjs <artifact-dir>')
  process.exit(2)
}

const root = resolve(import.meta.dirname, '..')
const target = resolve(root, 'public/classifier')
const ortTarget = resolve(root, 'public/ort')
await mkdir(target, { recursive: true })
await mkdir(ortTarget, { recursive: true })

const candidatePath = resolve(artifact, CANDIDATE_FILE)
const candidate = existsSync(candidatePath) ? readCandidate(JSON.parse(await readFile(candidatePath, 'utf8'))) : null

for (const name of STAGED_FILES) {
  const source = resolve(artifact, name === 'model.onnx' && candidate ? candidate.sourceModelFile : name)
  await cp(source, resolve(target, name))
  const size = (await stat(source)).size
  console.log(`${name} ${(size / 1e6).toFixed(1)} MB`)
}

for (const name of ORT_FILES) {
  await cp(resolve(root, 'node_modules/onnxruntime-web/dist', name), resolve(ortTarget, name))
}

if (candidate) {
  const staged = await hashFiles(target)
  const changed = STAGED_FILES.filter((name) => staged[name] !== candidate.files[name])
  if (changed.length > 0) {
    console.error(`staged files differ from ${CANDIDATE_FILE}: ${changed.join(', ')}`)
    process.exit(1)
  }
}

const versionFile = ['manifest.json', 'model-version.json'].find((name) => existsSync(resolve(artifact, name)))
const manifest = candidate ?? (versionFile ? JSON.parse(await readFile(resolve(artifact, versionFile), 'utf8')) : {})
const modelVersion = manifest.modelVersion ?? basename(artifact)
await writeFile(resolve(target, 'model-version.json'), `${JSON.stringify({ modelVersion }, null, 2)}\n`)
console.log(`modelVersion ${modelVersion}`)

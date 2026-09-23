import { cp, mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const ARTIFACT_FILES = ['model.onnx', 'tokenizer.json', 'labels.json', 'selective_policy.json', 'preprocessing.json']
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

for (const name of ARTIFACT_FILES) {
  const source = resolve(artifact, name)
  await cp(source, resolve(target, name))
  const size = (await stat(source)).size
  console.log(`${name} ${(size / 1e6).toFixed(1)} MB`)
}

for (const name of ORT_FILES) {
  await cp(resolve(root, 'node_modules/onnxruntime-web/dist', name), resolve(ortTarget, name))
}

const versionFile = ['manifest.json', 'model-version.json'].find((name) => existsSync(resolve(artifact, name)))
const manifest = versionFile ? JSON.parse(await readFile(resolve(artifact, versionFile), 'utf8')) : {}
const modelVersion = manifest.modelVersion ?? basename(artifact)
await writeFile(resolve(target, 'model-version.json'), `${JSON.stringify({ modelVersion }, null, 2)}\n`)
console.log(`modelVersion ${modelVersion}`)

# Question classifier runtime

Local inference for the autofill question classifier. It never fills a field on
its own. The fill and capture paths do not call it.

## Suggestions (off by default)

- Switch: `tp.classifierSuggestions` in `storage.local`, the popup setting
  "Classifier suggestions (beta)". Off unless turned on.
- Switch off: the content script answers the picker with no row and never
  messages the background. The background also checks the switch before it
  reads answers, fetches labels or starts the offscreen document. Turning the
  switch off closes the offscreen document. A request still running at that
  moment answers `disabled`, and the document is closed again after it ends.
- Trigger: opening the field picker sends `classifier.suggest` through the page
  bridge to the background. Nothing runs during fill.
- Request check: `readSuggestionRequest` in `suggest.ts` runs in the content
  script and again in the background. It needs a known `answerKind`, a
  `fieldType` of 1 to 64 characters, a `questionText` of at most 4,096
  characters (empty is allowed), at most 60 `optionLabels` (the DOM extractor's
  `MAX_OPTIONS`), each at most 4,096 characters, and at most 65,536 option
  characters in total. Anything else is dropped before classification.
- Order: exact question slug, then word overlap, then the classifier.
- Exact and word-overlap matches never load label names or start the model.
- Answer link: each stored answer is classified with job country `_unknown`, no
  options, and its own field type. `answerLabels.ts` caches the label in
  `storage.session` per answer id, keyed by the answer's `updatedAt`, its exact
  classifier input, and the runtime identity.
- Runtime identity: the offscreen document hashes the bytes of every staged
  file (`model.onnx`, `tokenizer.json`, `labels.json`, `selective_policy.json`,
  `preprocessing.json`, `model-version.json`) and the runtime contract constants
  (`runtimeIdentity.ts`). Every classify answer carries it. `modelVersion` alone
  is not trusted, because the staged files can change under the same version.
  Stored-answer labels from another runtime identity are discarded.
- Answer choice: among compatible answers whose accepted label equals the field's
  accepted label, the newest `lastUsedAt ?? updatedAt` wins, then the newest
  `updatedAt`, then the lowest `id`. An answer whose value cannot be filled is
  skipped.
- Job country: only the `jobCountry` the public site sends with
  `application.handoff`, checked against the 249-code training allowlist in
  `jobCountry.ts`. Anything else, and every page without a handoff, is `_unknown`.
  The public site maps `UK` to `GB` before it sends.
- Context lifetime: the bound tab context stores the normalized handoff
  destination. A top-frame commit or History API navigation to any other origin,
  path or query removes the whole context, application id and country together
  (`followApplicationNavigation` in `capture/applicationContext.ts`). A
  fragment-only change keeps it. Subframe navigations are ignored. An
  application flow that moves to another URL therefore loses its context; that
  is intended.
- Page boundary: only `{ title, value }` of the suggested saved answer crosses
  into the page (`suggestClient.ts`). Classifier labels, calibrated confidence,
  abstention reasons, errors and model metadata stay in the extension. `value`
  is the fill value; a text value keeps its fill flag `confidence: 'guess'`.
- The popover shows one row, the suggested saved answer, only when a saved
  answer was found. The row is titled by the answer text, else by the value it
  fills. The field is filled only when the user clicks the row.
- A late answer to an older request, or to a closed picker, is dropped
  (`ui/picker/suggestion.ts`).
- A request dropped by a stopped service worker is sent once more
  (`suggestClient.ts`). A failed model load is retried on the next request.
- `bun run smoke:suggest` checks this path in real Chrome. See
  [Suggestion smoke test](#suggestion-smoke-test).

## Layout

| file | role |
| --- | --- |
| `contract.ts` | types and the constants shared with the Python trainer |
| `preprocess.ts` | NFC plus whitespace collapsing, and the input template |
| `policy.ts` | shape masking, temperature, gates, threshold |
| `session.ts` | tokenizer, batching, ONNX run, decision |
| `assets.ts` | loads the artifact files and rejects unsupported schema versions |
| `offscreenClient.ts` | background-side API; creates the offscreen document |
| `runtimeIdentity.ts` | the hash of the staged files and contract that keys cached labels |
| `suggest.ts` | request check, match order, answer choice |
| `answerLabels.ts` | stored-answer labels cached per revision, input and runtime |
| `suggestionService.ts` | switch, request check, then suggestion |
| `suggestionRuntime.ts` | the browser wiring of the suggestion service |
| `suggestClient.ts` | content-side request, retry, and the row sent to the page |
| `messages.ts` | the message contract between background and offscreen |
| `attestation.ts` | the browser attestation contract shared with the Python trainer |

The model runs in an offscreen document (`src/entrypoints/offscreen/`), because
an MV3 service worker is stopped while idle and would reload the model on every
wake.

## Assets

The runtime reads five files from `public/classifier/`, which is ignored by git.
Stage them from a training artifact:

```sh
node scripts/stage-classifier-assets.mjs <training-artifact-dir>
```

That also copies the onnxruntime WASM binary into `public/ort/`.

When the artifact has `browser_candidate.json`, staging copies the selected model file to
`model.onnx`, takes the model version from the candidate, and fails if any staged digest
differs from the candidate.

## Parity with the trainer

`parity.spec.ts` compares the serialized text, the token ids and the decision
against fixtures generated by the trainer from training-split rows. Three of its
checks need staged assets and skip without them. `CLASSIFIER_STRICT_PARITY=1`
turns that skip into a failure, so a verification run cannot pass by skipping:

```sh
CLASSIFIER_STRICT_PARITY=1 bun test src/classifier/parity.spec.ts
```

`model-parity.spec.ts` runs the ONNX model through onnxruntime-web and compares
logits and decisions with Python. It needs staged assets and is opt-in:

```sh
CLASSIFIER_MODEL_PARITY=1 bun test src/classifier/model-parity.spec.ts
```

Regenerate the fixtures after any change to preprocessing, the policy or the
model:

```sh
training/.venv/bin/python scripts/parity-fixtures.py \
  training/var/work/home/runs/<run> training/var/artifacts/<candidate> \
  src/classifier/__fixtures__/parity.json
```

The generator lives in `scripts/`, so a clean checkout can rebuild the fixture
with only the training submodule and its artifacts.

Fixtures never use gold test rows, so regenerating them cannot spend a final
test set.

## Chrome smoke test

Bun proves the math and the WASM backend. It does not prove Chrome messaging,
the extension CSP or the offscreen lifecycle, so there is a browser test:

```sh
bun run build
CHROME_PATH="<chrome for testing binary>" bun run smoke:chrome
```

It bundles the real exported client from `offscreenClient.ts` into an extension
page, so request correlation, reconnection and disconnect handling are the
shipped code and not a copy written for the test. It then runs 17 checks: the
three decisions must equal the committed Python fixtures, including confidence
to six decimals, two concurrent calls must each get their own answer, and
classification must survive the service worker being terminated, the client
disconnecting, the offscreen document closing mid-request, and the document
being closed and reopened.

Two things it depends on:

- Chrome 137 and later ignore `--load-extension`, so the test needs a Chrome for
  Testing binary (for example the one under `~/.cache/puppeteer`).
- Classification requests must come from a context that outlives the model load.
  A service worker is stopped while idle, so a request made from it can be lost
  while the model is still loading.

## Suggestion smoke test

```sh
bun run build
CHROME_PATH="<chrome for testing binary>" bun run smoke:suggest
```

It loads a copy of `.output/chrome-mv3`, so the build tree is never changed, and
checks that the built model bytes equal the staged ones. All network requests
are blocked, and every request from every page, the service worker and the
offscreen document is recorded. A Greenhouse-shaped page and a job page on
`talentprofile.net` are served by DevTools request interception. The job page
runs the public website's own `jobCountryForExtension`, read from
`../public-website` or `PUBLIC_WEBSITE_DIR`.

The signed-in picker runs on test data made inside the script: a JWT with
`alg: none`, a fake signature and a year-2100 `exp`, a synthetic profile, and
three saved answers. The extension only decodes the token's claims on this path.
The script fails if the tokens change or any backend request is made.

It checks the switch, request limits, the cold load with the service worker
stopped, the job countries DE, GB and `_unknown`, a deliberate close, a failed
model load and its recovery, a request running while the switch turns off, the
real handoff binding for UK, Germany, no country and a raw `UK`, the page
bridge, the signed-out and signed-in picker, exact and word-overlap rows without
the model, the classifier row and its fill, abstention and no-answer, the cached
reopen, and the context clearing on same-tab navigation. It exits 0 only when
every check passes and the temporary Chrome profile is removed.

## Browser attestation

A final training run clears `browser_runtime_unverified` only with a browser attestation of
the exact selected artifact, built from the extension commit frozen in the preregistration.
After `browser-candidate` in the trainer, staging, and committing every change:

```sh
CHROME_PATH="<chrome for testing binary>" bun run smoke:chrome --attest <training-artifact-dir>
```

Attest mode, in order:

1. Reads `browser_candidate.json`.
2. Refuses, and writes nothing, when the tree has uncommitted changes or `HEAD` is not the
   candidate's `extensionCommit`.
3. Deletes `.output/chrome-mv3` and runs `bun run build`.
4. Hashes every file of `.output/chrome-mv3` into the build tree digest.
5. Hashes the staged files, then runs `CLASSIFIER_STRICT_PARITY=1` and
   `CLASSIFIER_MODEL_PARITY=1` parity.
6. Runs the 17 Chrome checks with Chrome loading `.output/chrome-mv3`.
7. Re-hashes the build tree and re-reads the commit and the tree state.
8. Writes `browser_attestation.json` into the artifact only when the tree stayed clean, the
   commit never changed, the build tree did not change, the built classifier files equal the
   candidate, and every required check passed.

The tree digest is SHA-256 over `<path>\0<file sha256>\n` lines sorted by path; the trainer
recomputes it. The required check names and build files live in `attestation.ts` and in the
trainer's `browser_attestation.py`; changing them needs a new attestation schema version on
both sides.

## Transport

The client talks to the offscreen document over a named port, not
`runtime.sendMessage`. A broadcast message reaches every extension context, and
the background router answers an unknown kind immediately, so the offscreen
reply loses the race and the caller sees `Unknown message kind`. `onConnect` is
filtered by port name in every context, so only the classifier answers.

The offscreen document can disappear under a caller: Chrome may reclaim it,
another caller may close it, or the extension may reload. A disconnect loses
only the in-flight request, so the client retries it once, which reopens the
document.

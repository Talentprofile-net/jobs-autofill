# Apply Form Training And Execution Contract

Status: canonical.

The Prisma source schema owns stored truth.

Update this file when the schema or runtime contract changes.

## Purpose

The scrape worker collects application form data.

The scrape worker never fills a form.

The scrape worker never submits an application.

The collected corpus trains a small question classifier.

Qwen acts as the teacher.

The training pipeline exports the student model to ONNX.

The extension will run the student model locally.

Premium headless execution will use the same model and data contracts.

Headless execution must not submit without candidate review.

Bulk autonomous application is not allowed.

## Classifier Contract

The classifier input is:

```text
questionText + fieldType + jobCountry
```

The classifier output is one active `questionLabelEnum`.

The job country changes the question meaning.

The talent country does not belong in the classifier input.

Example:

```text
US job -> need_visa_us
TH job -> need_visa_th
```

The answer resolver uses the talent profile and answer history after classification.

Missing enum history makes the answer predictor use the live talent profile.

The extension must receive explicit job context before it can run a country-aware classifier.

The extension must not infer job country from question text or page URL.

Country-free extension inference is not implemented.

## Corpus

`questionLabel` owns the training corpus.

One row owns one deterministic input identity.

The identity is:

```text
normalizedQuestion + fieldType + answerKind + jobCountry
```

`normalizedQuestion` is not globally unique.

`jobCountry` is ISO 3166-1 alpha-2 or `_unknown`.

`jobAdId` records the first source job.

`jobAdId` is a scalar pointer.

It is not a Prisma relation.

`occurrenceCount` records repeated observations.

The backend increments it atomically.

The worker never sends a computed next count.

`options` stores raw evidence.

`options` does not join or deduplicate corpus rows.

`labelEnumId` stores the teacher class.

Enum merge repoints every live reference before deleting the loser.

## Enum Space

`questionLabelEnum` owns the classifier class space.

Each enum stores `label`, `description`, `valueShape`, and `examples`.

Each enum stores `active` and `verified` state.

A new teacher proposal starts active and unverified.

`valueShape` must equal the field `answerKind`.

The labeler enforces this rule.

The capture endpoint enforces this rule.

The merge endpoint enforces this rule.

Enums with different value shapes must not merge.

A verified enum must not be the merge loser.

Country scope comes from a reviewed map keyed by `labelEnumId`.

The reviewed value is an ISO 3166-1 alpha-2 code or `null`.

`null` means the class is country independent.

A lowercase two-letter label suffix is a review suggestion only.

The trainer must not enforce a country from the label text.

Example:

```text
work_permit_de
need_visa_us
```

Every class needs a reviewed country-scope entry before model approval.

Every unreviewed class must abstain with `class_not_evaluable`.

The suffix suggestion must not change runtime eligibility.

The worker loads active enums with an immutable `createdAt + id` keyset.

The load stops at the 20,000-row safety cap and warns when truncated.

The worker does not run embeddings.

It ranks lexical candidates with Dice similarity.

Qwen reuses a compatible candidate or proposes a new enum.

The curation pass starts when ten active enums remain unverified.

The moderator returns loser and winner pairs.

The backend merges each pair atomically.

## Normalization

`normalizeQuestion` owns question identity normalization.

`normalizeAnswerKind` owns answer shape normalization.

Valid answer kinds are:

```text
boolean
choice
multiChoice
text
number
date
file
```

Boolean-shaped option sets normalize to `boolean`.

Placeholder values do not count as answers.

Form fingerprints must not deduplicate corpus rows.

## Training Repository

`jobs-autofill-training` owns offline model training.

Repository:

```text
git@github.com:Talentprofile-net/jobs-autofill-training.git
```

The extension pins it at `training` as a nested submodule.

The training repository owns:

- REST corpus export client.
- Dataset validation and snapshot creation.
- Deterministic grouped split.
- Blind gold review packets.
- Gold calibration and final-test splits.
- Student training.
- Per-variant calibration and abstention policy.
- Optional dynamic int8 comparison.
- Runtime variant selection.
- Evaluation.
- Advisory final-test accounting.
- ONNX export and parity check.
- Candidate manifest.
- Synthetic tests and isolated CI.

The training repository does not own:

- Browser inference.
- Form scrape or teacher label work.
- Backend corpus storage.
- Model approval, promotion, or deployment.
- Extension packaging.

The training repository stays outside the Nx workspace.

Root CI does not install its Python dependencies.

Training CI uses synthetic data only.

Training CI does not call production.

Git does not store production corpus data, secrets, checkpoints, or model artifacts.

## Corpus Export API

The backend serves:

```text
GET /import/training/question-labels
```

The existing import API key protects this route.

The route is read only.

The trainer never reads PostgreSQL directly.

The route accepts `limit` and an opaque `cursor` only.

`limit` defaults to 500.

`limit` has a maximum of 1,000.

Unknown query keys return `400 invalid_query`.

A malformed cursor returns `400 invalid_cursor`.

Pagination uses an `id` keyset.

The first page fixes `asOf` for later pages.

Each page carries the same corpus revision.

The revision contains `asOf`, `corpusMaxUpdatedAt`, `eligibleCount`, and `enumDigest`.

The client restarts the full export when any revision value changes.

The response uses schema version `1`.

One item contains:

- `id`.
- `questionText`.
- `normalizedQuestion`.
- `fieldType`.
- `answerKind`.
- `jobCountry`.
- `occurrenceCount`.
- `updatedAt`.
- Enum `id`, `label`, `valueShape`, `active`, `verified`, and `updatedAt`.

The route does not return page URL, job ID, options, profile field, answer, profile, or contact data.

The route returns exclusion counts only for rejected rows.

The route refuses more than 20,000 eligible rows with `409 corpus_exceeds_cap`.

The route never truncates a training export.

## Dataset Eligibility

A row trains only when `labelEnumId` exists.

Its enum must be active.

Its enum must be verified.

Its `answerKind` must equal the enum `valueShape`.

The classifier features remain:

```text
questionText + fieldType + jobCountry
```

`answerKind` checks integrity only.

`normalizedQuestion` owns split grouping only.

No normalized question group may cross evidence splits.

A reviewed group leaves teacher training and teacher validation.

Reviewed groups split into gold calibration and gold test.

Other groups split into teacher training and teacher validation.

An unreviewed row inside a reviewed group is excluded.

A gold `exclude` decision excludes the row.

A gold `unknown` decision requires abstention.

`occurrenceCount` may set a bounded sample weight.

The trainer must not duplicate corpus rows before the split.

The teacher corpus contains hard labels only.

Teacher logits do not exist.

The pipeline performs supervised student training from hard teacher labels.

Teacher validation selects the training checkpoint.

Gold calibration fits confidence and abstention policy.

Gold test measures the selected runtime variant only.

The pipeline returns `insufficient_data` when it cannot create a valid teacher training and validation run.

The pipeline must not fabricate a successful model.

## Candidate Artifact

The pipeline writes:

- `model.onnx`.
- `tokenizer.json`.
- `preprocessing.json`.
- `labels.json`.
- `metrics.json`.
- `dataset.json`.
- `base_model.json`.
- `verification.json`.
- `policy.<variant>.json`.
- `calibration.<variant>.json`.
- `selection.json`.
- `selective_policy.json`.
- `browser.json`.
- `manifest.json`.

The pipeline may also write `model.int8.onnx` and `quantization.json`.

Input serialization version is `autofill-question-input.v1`.

ONNX inputs are `input_ids` and `attention_mask`.

ONNX output is `logits`.

`labels.json` maps each output index to `labelEnumId`.

The pipeline verifies PyTorch and ONNX logit parity.

The pipeline verifies equal top-one predictions on teacher validation and gold inputs.

Each runtime variant owns its own calibration policy.

The pipeline selects a runtime variant from teacher validation and gold calibration only.

The runtime bundle identity covers variant, model, policy, tokenizer, preprocessing, labels, and country-scope map.

Changing any runtime bundle input creates a different candidate.

The pipeline refuses evaluation or finalization after a selected runtime file changes.

The final-test identity covers the exact serialized classifier input, answer kind, gold decision, expected label, row ID, and schema versions.

Notes, review time, occurrence count, row timestamps, and calibration rows do not change final-test identity.

The first runtime bundle evaluated against one final-test identity is `final`.

A different runtime bundle against the same final-test identity is `exploratory`.

An identical retry reuses its ledger entry.

The final-test ledger uses a file lock and atomic replacement.

The final-test ledger is local and advisory.

External immutable holdout governance is not implemented.

The pipeline marks every artifact `candidate`.

The pipeline never replaces a different artifact with the same candidate version.

No production acceptance threshold is locked.

Model approval is open.

Artifact promotion is not implemented.

## Worker Runtime

`yarn worker:index` starts the apply-form training lane.

The provider reads unscraped job ads through the backend import API.

The provider orders rows by `createdAt DESC, id DESC`.

The provider uses a matching keyset cursor.

Retained BullMQ jobs must not block older eligible jobs.

A queue failure must not advance past the failed row.

Workday is unsupported.

Authenticated application walls are unsupported.

The current worker captures only the first reachable form DOM.

It does not walk later form steps.

It writes snapshot scope `initial_dom`.

HTTP and navigation failures throw into BullMQ retry.

Confirmed absence and unsupported flows are terminal.

The worker classifies each extracted field before persistence.

One backend transaction stores:

- The form snapshot.
- Every form field.
- Every new corpus row.
- Every occurrence increment.
- Every enum resolution.
- The job scrape success marker.

The transaction commits all data or no data.

A deferred write leaves the job unmarked until the write drainer commits it.

## Form Snapshots

`applicationFormSnapshot` owns one observed target form.

Every snapshot belongs to one `jobAd`.

Every snapshot stores source URL, job country, ATS, fingerprint, and scope.

Valid scopes are `initial_dom` and `complete`.

The fingerprint identifies an identical snapshot for the same job and scope.

The fingerprint does not identify a corpus row.

`applicationFormField` owns the ordered target fields.

Each field stores its target question, type, answer kind, options, requirement, and step.

Each field may link to its corpus row and canonical enum.

Each field may store classifier version and confidence.

## Talent Answers

`talentAnswer` owns observed candidate answers.

The answer identity is:

```text
talentProfileId + talentJobApplicationId + normalizedQuestion
```

`labelEnumId` links answer history to the classifier class.

`talentJobApplicationId` links the answer to the candidate application.

`sourceAnswerId` must belong to the same talent profile.

Application-less answer rows remain valid.

PostgreSQL treats null application IDs as distinct in the unique key.

The capture batch commits all answers or no answers.

The capture batch accepts only an explicitly handed-off external application owned by the caller.

Without an explicit ID, the backend may reuse a recent URL match or create a URL-only external application.

## Public Job Handoff

The public job page creates or resolves the external `talentJobApplication` when a profile exists.

It sends that application ID to the extension before opening the company tab.

The company tab still opens when the extension is absent.

The extension pairs the handoff with the opened tab.

Unpaired handoff records expire.

A paired application context lasts for the tab session.

Successful answer capture clears the paired context.

Tab close clears the paired context.

Direct browsing has no explicit application ID.

Direct browsing uses the URL fallback.

## Extension Capture

The extension captures only touched or resolver-filled fields.

It reads option labels from the live DOM.

It stages records in `storage.session` before page destruction.

`storage.session` survives service-worker suspension.

It does not survive browser restart.

The extension commits a stage only after submit-success detection.

The extension discards a confirmed failed or abandoned stage.

A top-level navigation may commit a stage after the source page is destroyed.

The extension sends `labelEnumId = null` until country-aware inference exists.

Null enum IDs are safe to backfill.

Wrong inferred enum IDs are not safe.

## Preview And Diff

`applicationFillPlan` owns a mutable draft for one talent, job, application, and snapshot.

The database constrains those relations to the same owners.

`applicationFillPlanField` owns one planned target field.

Each planned field stores:

- The target field and question.
- Whether the target requires a value.
- The planned answer value and display text.
- The source kind.
- The source answer or profile field.
- The source answer version time.
- The decision outcome and reason.

Valid source kinds are `profile`, `learned_answer`, `user_override`, `generated`, `manual`, and `none`.

The UI can derive the target-form diff from plan outcomes.

`missing` means the target asks for data the candidate does not have.

`needs_confirmation` means the candidate must decide before approval.

`unsupported` means the engine cannot apply the field.

`will_fill` means the preview has a concrete value.

The preview UI is not implemented.

The plan generator is not implemented.

## Approval And Execution

Approval creates an immutable `applicationFillPlanRevision`.

The revision copies snapshot, talent, model version, and content hash.

The revision copies every approved field and its provenance.

Later draft edits do not change an approved revision.

`applicationExecutionAttempt` owns one execution try against one approved revision.

`applicationExecutionField` owns one field result for that try.

Attempts and field results are append-only records.

Execution must use an approved revision.

Execution must not use a mutable draft.

The executor is not implemented.

Submission is not implemented.

## Training Work Still Open

The corpus must first contain real observations.

The production corpus export has not run.

The production corpus language and class distribution are unknown.

The production base model choice is open.

The production model acceptance threshold is open.

The reviewed country-scope map is open.

The country-scope reviewer owner is open.

The int8 degradation limits are open.

The minimum gold groups per class is open.

External immutable final-test governance is open.

No model is approved.

The remaining training work is:

1. Deploy the protected corpus export route.
2. Export and inspect the real corpus.
3. Choose the production base model from corpus evidence.
4. Train and evaluate a production candidate.
5. Lock the acceptance threshold.
6. Approve and promote a passing artifact.
7. Ship the approved model with the extension and headless runtime.
8. Replace question-text matching with classifier enum matching.

Multilingual training is not implemented.

Complete multi-step form scraping is not implemented.

Country-aware extension inference is not implemented.

Premium headless planning, review UI, execution, and submission are not implemented.

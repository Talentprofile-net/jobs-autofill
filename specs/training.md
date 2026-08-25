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

The student model will export to ONNX.

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

Country-dependent labels use a lowercase country suffix.

Example:

```text
work_permit_de
need_visa_us
```

Country-independent labels use no country suffix.

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

The training pipeline must then:

1. Export `(questionText, fieldType, jobCountry) -> labelEnumId` examples.
2. Distil the student model from the teacher corpus.
3. Validate class and value-shape accuracy.
4. Export the student to ONNX.
5. Ship the model with the extension and headless runtime.
6. Replace question-text matching with classifier enum matching.

Multilingual training is not implemented.

Complete multi-step form scraping is not implemented.

Country-aware extension inference is not implemented.

Premium headless planning, review UI, execution, and submission are not implemented.

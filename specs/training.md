# TalentAnswer + Question Labeling — Canonical Spec

**Status:** Canonical. Where this doc and the live Prisma schema
disagree, the schema wins; flag the disagreement and update this doc.

**Scope of this doc:** the storage model for user answers, the
classifier's role at fill time, and the capture flow. Out of scope:
scraper workers, the offline labeler, classifier training, ONNX export.
Those are deferred work, tracked separately.

**No production data:** the feature has never shipped. Schema changes
do not require backfill, dual-write windows, or collision-merge
strategies. Drop and recreate freely.

---

## Mental model

Job context determines the enum. The enum determines storage.

The same human question ("Do you require visa sponsorship?") becomes a
different enum depending on where the job is. `need_visa_us` and
`need_visa_th` are distinct enums. A US citizen applying to a Thai job
needs a visa; same person applying to a US job does not. Two enums, two
durable answers, both stored as plain `talentAnswer` rows for that user.

Storage is one row per (user, application, normalizedQuestion). Job
context is a classifier input, not a storage column. The classifier
sees question text plus the application's location/role/etc and emits
the right enum. Resolver looks up the user's answer for that enum and
fills.

Every row is the user's durable answer for one (question, application)
pairing. Application-less rows (when capture happened outside a
detectable application) are valid; the classifier sorts them out later.

---

## Storage

### `talentAnswer`

Fields:

- `id`
- `talentProfileId` (FK, cascade)
- `talentJobApplicationId` (nullable FK, cascade). Provenance. Null is
  valid when capture happened without a detectable application.
- `sourceAnswerId` (nullable, set-null). Lineage between derived
  answers.
- `questionText` — raw label as shown on the page.
- `normalizedQuestion` — slugified form. Join key to `questionLabel`.
- `fieldType` — `TextInput`, `SimpleDropdown`, etc. Disambiguator.
- `section` — `employment 1`, `education 2`, or null.
- `answerKind` — `string`, `choice`, `multiChoice`, `boolean`, `date`.
- `answerValue` (JSON) — the structured value.
- `answerText` — human-readable rendering for display/search.
- `profileField` — dot-path into `talentProfile` shape if the resolver
  matched a profile column. Strongest training signal for the labeler.
- `resolverOutcome` — `filled` / `skipped` / `unsupported` / `failed`
  at the time this answer row was created or updated. Used for
  correction-rate aggregation.
- `pageUrl`, `ats` — capture provenance.
- `source` — `manual` / `correction` / `resolver_filled` /
  `resolver_skipped`.
- `lastUsedAt` — last time resolver filled with this answer.
- `createdAt`, `updatedAt`.

Unique constraint:

```
@@unique([talentProfileId, talentJobApplicationId, normalizedQuestion])
```

Postgres treats `NULL` in unique constraints as distinct, so multiple
application-less rows for the same `(user, normalizedQuestion)` can
coexist. That's intentional.

Indexes:

```
@@index([talentProfileId])
@@index([talentJobApplicationId])
@@index([profileField])
```

### Fields explicitly NOT on `talentAnswer`

These were considered and dropped. Do not re-add without naming a
concrete consumer.

- `contextType` — old two-context model. The application column carries
  context now.
- `reusable` — old runtime discriminator. Every row is durable.
- `confidence` — audit-only signal with no consumer.
- `labelEnumId` — joined through `questionLabel.normalizedQuestion` at
  read time. No denormalization.
- `options` — observed option values. Always null in capture. No
  consumer.
- `externalQuestionId` — ATS-internal field ID. No consumer.
- `submittedAt` — redundant with `createdAt` because rows are only
  created on submit-success. If the capture flow ever changes to
  pre-create draft rows, re-add.

### `questionLabel`

Fields:

- `id`
- `questionText`, `normalizedQuestion` (unique)
- `fieldType`, `sectionType`
- `profileField` — labeler-assigned shortcut to a profile column.
- `labelEnumId` — labeler-assigned enum (FK to `questionLabelEnum`,
  set-null).
- `createdAt`, `updatedAt`.

Fields explicitly NOT on `questionLabel`. All dropped because no
labeler workflow exists yet:

- `optionsObserved`, `labelConfidence`, `secondaryLabel`,
  `suggestedNewLabel`, `labelerVersion`, `labeledAt`, `needsReview`.
- `reviewedByHuman`, `reviewedLabel`, `reviewedAt`, `reviewedBy` —
  manual review workflow. No reviewer.
- `sourceUrl`, `sourceAts`, `sourceDomain`, `externalQuestionId`,
  `extractionTier`, `extractionVersion`, `labelResolutionPath` —
  scraper provenance. Scraper out of scope.
- `occurrenceCount`, `firstSeenAt`, `lastSeenAt` — popularity stats
  for a labeler UI that doesn't exist.

If/when a labeler workflow ships, add what's actually needed at that
point.

### `questionLabelEnum`

Fields:

- `id`
- `label` (unique) — the enum identifier, e.g. `need_visa_us`.
- `description`, `valueShape`, `examples` — human/LLM authoring hints.
- `active` — soft-delete.
- `createdAt`, `updatedAt`.

Dropped: `promotedFromOther` (promotion workflow doesn't exist).

### `questionLabelEnumChange` — REMOVED

Was an audit log of enum mutations. No automated decision used it. No
compliance need. Dropped entirely.

### Enum naming convention

Context-dependent families: `{family}_{iso3166_alpha2_lowercase}`.
Examples: `need_visa_us`, `need_visa_th`, `work_permit_de`,
`tax_id_fr`, `salary_currency_jp`.

Country-independent enums use the bare name: `cover_letter`,
`heard_about_us`, `notice_period`, `gender`, `veteran_status`.

Pre-seeding all 195 ISO 3166-1 alpha-2 entries for known
context-dependent families: deferred until classifier is ready.

### `talentJobApplication`

Additions for capture-flow support:

- `originalJobPostUrl String?` — page URL where the application was
  submitted. Used for 24h-by-URL reuse.
- `@@index([talentProfileId, originalJobPostUrl, createdAt])`

`createdAt` is the submit timestamp; no separate `submittedAt` field.
Rows only exist after submit-success.

---

## Normalization

`@sindresorhus/slugify` is the normalizer. Configured in
`src/resolver/normalizeQuestion.ts`.

Both raw and normalized forms are stored:

- `talentAnswer.questionText` — raw, for training/review.
- `talentAnswer.normalizedQuestion` — slug, for the unique constraint
  and `questionLabel` join.

Same applies to `questionLabel`.

`normalizerVersion` column: not currently in the schema. Add when the
slugify config actually changes for the first time, alongside a
re-slugify script. Adding speculatively before then has no value.

---

## Capture flow

1. **Fill phase.** Extension fills fields. Each field records
   `resolverOutcome` and `profileField` if the resolver matched a
   profile column.
2. **Buffer phase.** Captures accumulate in extension memory per form.
   Not sent to backend.
3. **Submit detection.** Form submit fires. Extension waits for a
   per-ATS success signal.
4. **Application creation.** On success, extension POSTs to backend to
   create-or-reuse a `talentJobApplication`. Backend matches existing
   row by `(talentProfileId, originalJobPostUrl)` within 24h, else
   creates a new one. Returns `talentJobApplicationId`. Extension is
   responsible only for `originalJobPostUrl`. Scraped fields like
   company/title come from a separate worker, out of scope here.
5. **Flush phase.** Extension flushes buffered captures with the
   `talentJobApplicationId` attached.

### Submit success detection

Heuristic per ATS. Generic adapter does best-effort. Lean toward false
positives (junk application rows) over false negatives (lost
captures).

- **Greenhouse Classic:** URL navigates to a thank-you page (typically
  contains `confirmation` or `thanks`).
- **Greenhouse React:** stays on same URL; detect confirmation block.
- **Workday:** SPA navigation inside Workday's shell; watch for the
  submitted state via `data-automation-id` patterns.
- **Generic:** wait 3 seconds after submit. If the form is gone or
  replaced with content matching "thank you" / "application received"
  / "we'll be in touch" (case-insensitive), treat as success.
  Otherwise drop the buffer.

### Application reuse policy

Match by `(talentProfileId, originalJobPostUrl)` within last 24 hours.
Reuse if found, else create new. Handles double-submit. Beyond 24h,
treat as a new application.

### Unsubmitted captures

Discarded on `pagehide` / tab close. Filled-but-not-submitted data is
low signal.

### `profileField` capture

Resolver returns `{ value: ProfileValue, profileField: string | null }`.
Every branch in `resolveField` that matches a profile column sets
`profileField` to the dot-path mirror of `talentProfile`'s shape
(`profileName`, `user.email`, `experience.company`, etc.). JSON-walking
paths drop array indices (`experience[].company` is `experience.company`;
the section ordinal lives in `section`).

Capture writes this through to `talentAnswer.profileField`. Pre-classifies
any question the resolver already handles.

### Placeholder filtering

`hasMeaningfulValue` uses `isPlaceholderText` from `src/core/match.ts`
for both scalar string and array branches. "Select...", "Please choose",
"--" must not become `talentAnswer` rows.

### Interaction tracking

Submit-sweep captures only fields the user actually touched, plus
fields the resolver explicitly filled. Default-state booleans on
untouched checkboxes must not become rows.

---

## Fill flow with classifier

```
question text + job context → classifier → enum label
                                              ↓
                                       talentAnswer lookup
                                              ↓
                                            fill
```

### Classifier inputs

- Question text (raw label, not slug).
- Field type (`TextInput`, `SimpleDropdown`, etc.).
- Section (if any).
- Job context, conditional on availability:
  - `talentJobApplication.jobAd.location` (country, ideally ISO
    alpha-2).
  - `talentJobApplication.jobAd.title` or role keywords.
  - `talentJobApplication.jobAd.company`.

### Job context availability

When job context is unavailable (no application, no jobAd, no
location), classifier emits the bare enum (`need_visa`) instead of the
country-suffixed one. Resolver tries the bare enum; if no answer
exists, falls back to existing regex resolver and Jaccard matcher.
Field stays empty if all paths fail.

A bare-enum row in `talentAnswer` is not invalid. It's the user's
default answer absent country context.

### Classifier deployment

- Trained model exported to ONNX. Bundled with extension or fetched on
  first install.
- Runs in-extension via `onnxruntime-web`. Inference per field at fill
  time.
- Targets (not commitments): model <30 MB, latency <50ms per field on
  mid-tier hardware. Revisit when trained model exists.

---

## Validation: corrections as the signal

`talentAnswer.source = 'correction'` means: resolver filled, user
changed before submit. Strong signal that the (question → enum →
answer) chain produced wrong output.

**Offline aggregation.** Group correction rows by
`(normalizedQuestion, fieldType)`. High rates per group mean:

- Labeler put this question in wrong enum, OR
- Classifier mispredicts on this question shape, OR
- User's stored answer for the right enum is stale, but the wrong
  question is mapped to the wrong enum so corrections cluster.

Manual review of high-correction groups. Per group:

- Relabel in `questionLabel` (labeler error).
- Remove the question from any enum (mapping was fundamentally
  miscategorized).
- Retrain classifier (systemic misprediction).

**No runtime feedback loop.** Classifier doesn't see correction rates
at inference. Corrections inform the next training cycle.

---

## Out of scope

- Scraper workers (`scrapedQuestion`, Worker A, Worker B).
- Offline labeler implementation.
- Enum-maintenance CLI.
- Classifier training infrastructure.
- ONNX export tooling.
- In-extension inference plumbing.
- Multilingual question handling. English-first.
- Cross-device sync. Server is source of truth. Last-write-wins on the
  unique constraint.

---

## Current debt

Real bugs remaining after PR 1 (schema reset). Each is implementation
work that aligns code to the model above.

### Capture / fill flow

- **Buffer captures until submit success**, then flush with new
  `talentJobApplicationId`. Currently captures fire immediately on
  submit-event.
- **Add `talentJobApplication` create-or-reuse endpoint.** Extension
  provides `originalJobPostUrl`; backend handles 24h reuse and stub
  creation.
- **Add submit-success detection per ATS.** Greenhouse Classic, React,
  Workday, generic.
- **Resolver emits `profileField`.** Return shape change:
  `{ value: ProfileValue, profileField: string | null }`. Thread
  through `resolveMany` → bridge → `BaseField.recordResolverOutcome`
  → capture record.
- **`hasMeaningfulValue` rejects placeholder text** via
  `isPlaceholderText`.
- **Track user interaction independent of resolver state.** Submit-sweep
  captures unedited default checkboxes today. Capture only touched or
  resolver-filled fields.
- **Date capture coercion.** `coerceToProfileValueShape` drops full
  `MonthDayYear`/`MonthYear` captures and mis-shapes partial ones as
  choices. Produce `{ kind: 'date', year, month?, day? }` consistently.

### Fill path

- **`lastUsedAt` is bumped** on learned-answer fill. `touchReusableAnswer`
  exists with no caller. Call it after successful fill or remove and
  drop the column.

### Picker UX

- **Picker icon disappears after tab switch on chat SPAs** (Claude,
  z.ai) in notesOnly mode. Likely cause: absolute-positioned host
  mounts with `opacity: 0` and flips on `focusin`; on SPA re-render
  after tab return, focus may already be on the field before new
  picker's listeners attach. Fix: at mount time check
  `document.activeElement === field || field.contains(document.activeElement)`
  and set `data-tp-visible="true"` if true.

### Server lifecycle (unrelated to capture but documented)

- **Await `httpServer.close()`** in shutdown. Currently fire-and-forget.
- **`.catch()` on `startServer()`.** Startup failures become unhandled
  rejections otherwise.
- **Error path on `httpServer.listen()`.** Otherwise EADDRINUSE silent.
- **Force-exit shutdown timeout** is dead code as written
  (`setTimeout(...).unref()` immediately before `process.exit(0)`).
  Move to start of `shutdown()` with `clearTimeout` in `finally`.

### Security

- **Restrict CORS** in `src/index-private.ts`. Currently fully open.
  Moderate severity because Bearer-only auth, no cookies.

### Cleanup

- **Pervasive `as any` casts** in `mainBridge.ts` and route configs.
  Replace with a typed request/response map.
- **Duplicate `captureAnswers` union variant** in `src/bridge/types.ts`.
- **Stale `'exact_hash'`** in `MatchMethod`. Never produced.
- **Dead functions:** `recordSubmittedAnswer`, `fetchReusableAnswers`,
  `findAnswerById`. Delete.
- **Split label resolvers** in generic adapter. `resolveLabel` falls
  through to `closestLegend`, so radio/checkbox options inside a
  fieldset can resolve to the legend text. Three functions:
  `resolveFieldLabel`, `resolveGroupLabel`, `resolveOptionLabel`.
  `resolveOptionLabel` must not include `closestLegend`.
- **`aria-readonly` check** in `isCandidateControl`. Combobox checks it,
  generic candidate check doesn't.

---

## Open questions deferred

- **Stale answers.** Salary expectation, notice period, etc. may become
  outdated. Defer until correction-rate data shows it matters.
- **Multilingual classifier.** English-first. Defer.
- **Stub `jobAd` enrichment.** When the create-or-reuse endpoint
  creates a stub against an unmatched URL, who enriches it and how
  does enrichment trigger reclassification?
- **AsyncQueue cancellation.** Per-task timeout leaves underlying work
  running. No evidence it bites.

---

## Schema is canonical

This document describes intent. The live Prisma schema describes truth.
When they disagree, the schema wins; update this doc.
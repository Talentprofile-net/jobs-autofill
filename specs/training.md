# TalentAnswer + Question Labeling — Canonical Spec

**Status:** Canonical. Where this doc and the live Prisma schema disagree,
the schema wins; flag it and update this doc.

---

## Goal

Build the autofill question classifier and the runtime answer store that
feeds it. The classifier maps an application-form question plus job
context to an enum; the answer layer holds and predicts what a given
talent answers for each enum.

The classifier is distilled from Qwen. The scraper worker calls Qwen as
the teacher to assign an enum to every observed field label at scrape
time. The resulting labeled rows are the distillation dataset. The student
is exported to ONNX and runs in the extension.

---

## Mental model: two stages, two countries

1. **Label a question to an enum.** The enum depends only on the job's
   country. "Do you require visa sponsorship?" on a US job is
   `need_visa_us`; on a Thai job it is `need_visa_th`. The classifier maps
   `(question text, fieldType, jobCountry) -> enum`. The applicant is not
   an input here.

2. **Answer the enum.** Whether a person needs that visa is a fact about
   the person, predicted at fill time from their profile and answer
   history. The applicant's nationality enters here, live, from
   `talentProfile`.

The corpus therefore stores the **job's** country and never a talent
country. "US citizen applies to a Thai job" is handled by stage 1
selecting `need_visa_th` and stage 2 predicting the answer from the
US-citizen profile. Observations are not exploded across candidate talent
countries.

---

## Runtime fill flow

```
question text + fieldType + jobCountry
        |
        v
   classifier  -->  enum (e.g. need_visa_th)
                     |
                     v
   talentAnswer history for that enum  +  talentProfile
                     |
                     v
        answer predictor  -->  predicted answer  -->  fill
```

The enum is the key into the user's answer history. No stored answer for
that enum means the predictor infers one from profile and history.

---

## Storage

### `talentAnswer` — runtime answers and predictor history

One row per `(user, application, normalizedQuestion)`. Application-less
rows are valid; `NULL` application is distinct under the unique constraint
(Postgres), intentionally allowing multiple application-less rows per
`(user, normalizedQuestion)`.

`labelEnumId` is stored directly on the row, set at capture from the
classifier output and repointed during enum merges. It is how answer
history is queried by enum. Job context for analysis is reached through
`talentJobApplication -> jobAd`, not copied onto the row.

### `questionLabel` — the labeled training corpus

Each row is one `(input features, teacher enum)` pair. `normalizedQuestion`
is **not unique**; many observations per question across countries is the
point.

- `questionText`, `normalizedQuestion`, `fieldType`, `answerKind`,
  `sectionType`, `options`.
- `jobCountry` — normalized ISO 3166-1 alpha-2 or `_unknown`. Part of the
  dedup key. (`jobAd.country` is raw and uncontrolled; this is the
  normalized form, which `jobAd` does not carry.)
- `jobAdId` — plain scalar pointer to the first source job, for soft
  context and debugging. Deliberately **not** a Prisma relation, so `jobAd`
  carries no reverse field and no FK cascade; it may dangle if the job is
  deleted. Set once at creation, never repointed.
- `occurrenceCount` — frequency of this `(question, fieldType,
  jobCountry)` across jobs. Best-effort; a crash-retry may over-count by
  one.
- `profileField`, `labelEnumId`.
- `createdAt` = first observation; `updatedAt` = last observation (bumped
  on every occurrence increment).

Dedup key: `@@unique([normalizedQuestion, fieldType, answerKind, jobCountry])`. Dedup
on the deterministic input, never on `labelEnumId` (the teacher's output,
noisy and pre-merge).

### `questionLabelEnum` — the class space

The set the classifier predicts over and Qwen labels into.

- `label` (unique), `description`, `valueShape`, `examples`.
- `active` — usable.
- `verified` — passed the moderator dedup/generalize pass. Qwen-created
  enums start `verified=false`.

Naming: context-dependent families use
`{family}_{iso3166_alpha2_lowercase}` (`need_visa_us`, `work_permit_de`);
country-independent enums use the bare name (`cover_letter`,
`notice_period`, `gender`). Per-country families are not pre-seeded; Qwen
creates on demand and the moderator pass generalizes.

---

## Normalization, not hashing

Form-structure hashes and option hashes are forbidden — option text and
markup vary too much across ATSs and career sites for a hash to be stable,
and a hash fragments one logical question into many noisy rows.

The reliable mechanism is an enhanced `@sindresorhus/slugify` normalizer
in `src/shared/normalization.ts`:

- `normalizeQuestion(text)` — slugified question; the dedup and join key.
- `normalizeAnswerKind(fieldType, options)` — canonical answer semantics:
  `boolean | choice | multiChoice | text | number | date | file`. Maps
  boolean-shaped option sets to `boolean` regardless of wording: `Yes/No`,
  `Agree/Disagree`, `True/False`, `Okay/Not okay`, `Accept/Decline`,
  `I agree/I do not agree`, a single checkbox, etc. (case- and
  whitespace-insensitive, after slugify).
- `isPlaceholderText(text)` — rejects "Select…", "Please choose", "--".

`options` is stored as raw evidence only and is **not** in the dedup key.
Consequence: a question whose option set differs between a 2-way and a
3-way variant collapses to one row. `answerKind` carries the meaningful
boolean distinction.

---

## Enum assignment and curation (fuzzy, no embeddings)

The host CPU cannot run embeddings, and the full enum set is too large to
send to Qwen per call. Candidate selection is lexical:

1. **Assignment.** Tokenize the `normalizedQuestion` (split on `-`/`_`,
   drop stopwords and tokens under 3 chars). Query `questionLabelEnum`
   with `OR` of `label`/`description` `contains token` (`mode:
   insensitive`, `active: true`, `take: 30`). Rank the bounded result
   in-process by Dice coefficient over character bigrams (pure JS, no DB,
   no deps). Send the top ~8 to Qwen as "reuse one of these if it fits."
   This keeps Qwen from coining `permission_to_work` when `work_permit`
   exists and shares the token `work`.

   Limitation: a synonym with no shared token (`notice_period` vs "when
   can you start?") is not retrieved; the moderator pass is the backstop.

2. **Creation.** If Qwen proposes outside the candidates, it returns the
   full shape `{ label, description, valueShape, examples }`. `label` is
   validated as lowercase snake_case (country suffix only for
   context-dependent families; no spaces or punctuation except `_`). The
   enum is created `active=true, verified=false`.

3. **Moderation.** After each job, count
   `questionLabelEnum where active and not verified`. At the threshold
   (10): for each unverified enum fuzzy-retrieve its lexical neighbors
   (verified plus other unverified), send the unverified set plus
   neighbors to the moderator LLM, and request `{loser, winner}` merge
   pairs for duplicates/generalizations.

4. **Merge**, per pair, in order:
   - `UPDATE questionLabel SET labelEnumId = winner WHERE labelEnumId = loser`
   - `UPDATE talentAnswer SET labelEnumId = winner WHERE labelEnumId = loser`
   - delete the loser.
   Repoint before delete — both FKs are `SetNull`, so deleting first would
   null the labels. Unverified enums named in no pair are set
   `verified=true`.

Sequential worker, so count-then-merge is race-free. May move to
`moderatorQueue` later; inline is fine.

---

## Capture flow (extension)

1. Fill phase records `resolverOutcome`, `profileField`, and the
   classifier's `labelEnumId` per field.
2. Captures buffer in extension memory per form.
3. Submit-success detection per ATS, generic best-effort, leaning toward
   false positives over lost captures.
4. On success, POST `originalJobPostUrl`; backend reuses a
   `talentJobApplication` matched on `(talentProfileId,
   originalJobPostUrl)` within 24h or creates one, returns its id.
5. Flush buffered captures with `talentJobApplicationId` and `labelEnumId`.

`hasMeaningfulValue` rejects placeholder text via `isPlaceholderText`.
Only touched or resolver-filled fields are captured. Unsubmitted captures
are discarded on `pagehide`.

---

## Out of scope

Classifier training infrastructure, ONNX export, in-extension inference,
multilingual handling (English-first), cross-device sync (server is source
of truth; last-write-wins on the unique constraint).

---

## Schema is canonical

This document describes intent; the live Prisma schema describes truth.
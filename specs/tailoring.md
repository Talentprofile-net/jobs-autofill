# TalentProfile Autofill — Feature Spec: Per-Job CV Tailoring, Skill-Gap Surfacing, Keyboard Picker, Shortcut Settings

## Scope & principles

Four features for the TalentProfile Autofill extension and `talents-backend`. Throughout, one rule governs the CV/skill work: **the tool surfaces and reorders the candidate's real data; it never invents, claims, or misrepresents.** Skill additions are user-asserted. CV tailoring is relevance-ordering and tail-omission only — there is no seniority-targeting or apparent-level reduction in any selection logic.

---

## Feature 1 — Keyboard-driven picker focus

**Goal:** Opening the picker (via hotkey or icon) lands keyboard focus inside the popover so the user can arrow/Enter-select immediately, without a click. Primary value is notesOnly mode.

**Behavior:**
- On open, focus the most-actionable element present at reveal: if a list with items exists (notesOnly always renders the notes list), focus the list root; if it opens into compose or an empty state, focus the textarea / nothing.
- Arrow up/down moves `activeIndex`, Enter selects, `/` opens search, Escape closes. (Handlers already exist in `PickerPopover.svelte`.)

**Implementation:**
- `pickerController.openPicker`: inside the existing reveal `requestAnimationFrame`, after setting `data-tp-shown="true"`, focus the `.popover` root (`root.focus({ preventScroll: true })`).
- The popover root already has `tabindex="-1"`, the keydown handler, and `activeIndex=0`.
- Profile loads async (`initialize()` awaits); ensure focus survives the `authState: checking → authenticated` transition. If focus is lost after the list mounts, re-focus the root once `authState` resolves and the list is present.
- Both hotkey (`handleHotkeyOpenPicker`) and icon paths already call `openPicker`, so both get focus.
- Close already restores `previousFocus`.

**Risk:** Low, self-contained.

---

## Feature 2 — Shortcut settings surface

**Goal:** Show current keyboard shortcut bindings in the popup settings panel, allow the user to reach the browser's reassignment page, and make `open_picker` user-assignable.

**Constraint:** Chrome does not allow runtime reassignment of `commands` shortcuts. This feature is **display + deep-link only**; copy must make that clear so it doesn't read as broken.

**Implementation:**
- Manifest `commands`: ensure `open_picker` and `fill_all` are both declared so they appear in `chrome://extensions/shortcuts`.
- `App.svelte` settings panel: new row(s) reading `browser.commands.getAll()`, rendering each command's `shortcut` (or "Not set"), with the existing `openShortcuts()` deep-link (already branches Chrome → `chrome://extensions/shortcuts`, Firefox → `about:addons`).

**Risk:** Low.

---

## Feature 3 — Per-job CV tailoring

**Goal:** Generate a CV tailored to a specific job — leading with relevant experience, omitting irrelevant tail entries — rendered as a PDF the candidate uploads to the ATS.

### Tailoring definition (hard boundary)
- **Reorder** experience entries by relevance to the target job.
- **Omit** irrelevant tail entries (oldest/least-relevant fall off).
- **Select** which skills subset to surface.
- Premium only: **rephrase** summary/bullets.
- **Never:** introduce experience, skills, or claims absent from the profile; never alter the set to reduce apparent seniority. Selection signal is skill/recency/role-category overlap — relevance, not level.
- The candidate is shown which entries were omitted from each version (transparency requirement, part of the output).

### Selection ownership
- **Heuristic always owns selection and ordering** of experience entries and skills. The omitted-entries list derives directly from it.
- **Free tier:** heuristic only.
- **Premium:** heuristic selection + an LLM call (run in parallel with PDF generation so it doesn't add latency) that **only rephrases prose** for the already-selected set. The LLM never changes the entry set.

### Backend route
- New file (e.g. `routes/talentProfile/cv.ts`), imported into the talentProfile router — **not** added to the config-driven RPC shape. Mirror the SSE pattern in `jobAd/llm.ts` (`runGenerator`: `initSSE`, keepalive, abort-on-client-close, `llmRequest` + Zod schema) for the premium prose call.
- Input: full profile + target job `{ title, description, suggestedSkills }`.
- Intermediate: a **structured** tailored CV (ordered experience entry ids, selected skills, summary). Structured form is internal — used to enforce that every entry traces to a real profile entry and to feed the PDF template. It is **not** the user-facing deliverable.
- Deliverable: a **PDF file** (the ATS expects a file upload, not fields).

### PDF rendering — reuse, don't rewrite
- Reuse `generatePDFBuffer` / `createPDF` as-is. Existing logic is long-tenured; keep it intact.
- The one needed change: `generatePDFBuffer` currently hard-truncates non-admin output to `[sortedExperience[0]]`. Add an **optional** parameter (a job-tailored ordered experience subset / ordered ids) that, when present, overrides the truncation; absent, existing callers behave exactly as today.

### Persistence & caching
- Store per-job CV PDF URLs in the `talentProfile.resume` JSON field (tbd; assume `resume` for now) as a map:
  ```
  { [skillsetHash]: pdfUrl }
  ```
- **`skillsetHash`** = hash over the **canonical, slugified, sorted** selected skill set (order-independent). See Shared Concern below — `React`/`react`/`reactjs` must collapse to one key.
- **Filename collision:** existing `saveToCache` writes `profile-{id}.pdf` (profile-scoped). Per-job PDFs must use a **job/skillset-scoped filename** so they don't overwrite each other or the canonical profile PDF.
- **Cache invalidation:** the cached CV depends on the profile, not just the skillset. On **any profile mutation**, clear the `resume` CV-map (simplest correct strategy; chosen over per-key version-stamping for v1). Otherwise a stale CV is served after the user edits experience.

### Heuristic scorer — reuse and extend (behavior-preserving)
- Extract the **overlap kernel** (skills/title/recency comparison) from `computeMatchScore` (`shared-helpers/scoring`, used by `match-attach.ts`) into a reusable function.
- `computeMatchScore` (talent-vs-job) keeps calling the kernel at whole-profile level and must produce **identical output** — this is a pure refactor of the existing path; verify behavior preservation before adding new callers.
- CV selection calls the same kernel **per experience entry** for entry-level relevance ranking/trimming.
- Net effect: shared, testable overlap logic benefits both match scoring and CV selection.

---

## Feature 4 — Skill-gap chip panel

**Goal:** During application-mode fill, surface skills the job requires that the profile lacks, as a multi-select chip panel. The user ticks skills they genuinely have; confirmed skills are added to the profile; the user can then regenerate the tailored CV on the updated profile.

**Truthfulness guard:** Chips are the user **asserting** "I have this." Nothing is pre-ticked; the tool never auto-selects or invents. The tool offers; the user claims.

**Behavior:**
- **Gap set** = job `suggestedSkills` minus profile `skills`, compared via canonicalization (see Shared Concern) — not the denormalized `skills_lowercase` column.
- Render gap skills as **checkbox chips** in a single panel; user multi-selects and confirms once (no per-skill blocking).
- Optional, lightweight "where did you use this?" — a single optional text field on the panel, not per-chip required.
- On confirm: persist ticked skills via the **existing talentProfile update RPC endpoint** (skills live on `talentProfile.skills` JSON; no new route). Extension calls it through the `apiFetch` path.
- Offer to regenerate the tailored CV (Feature 3) on the now-updated profile.

**Trigger:** application mode, when the gap set is non-empty.

---

## Shared concern — skill canonicalization (write once)

Canonicalization appears in **three** places: gap compare (F4), cache hashing (F3), and the overlap kernel (F3 scorer). Implement **one** shared utility (`canonicalizeSkill` / `canonicalizeSkillSet`) and route all three through it.

- Slugify (`@sindresorhus/slugify`) handles case/spacing (`React`, `react` → `react`) but **not synonyms** (`react` vs `reactjs` vs `react-js`). That's a synonym-resolution problem.
- **Open dependency:** `dice-rank.ts` imports from `../match/utils/skill-synonyms` (currently `stopWords`). **Determine what that module exports** — if it already maps synonyms → canonical, reuse it; if it's only stopwords, a canonical-skill resolver must be built. This determines whether the canonicalization utility is small or medium effort, and it gates the F3 hash, F4 gap compare, and the kernel.

---

## Build order

1. **Feature 1** (picker focus) — smallest, self-contained.
2. **Feature 2** (shortcut settings surface) — small.
3. **Shared:** investigate `skill-synonyms`; build `canonicalizeSkillSet`.
4. **Feature 4** (skill-gap chips) — feeds F3.
5. **Feature 3** (per-job CV) — scorer kernel extraction (behavior-preserving) → `/cv` route → heuristic selection → PDF param → caching → premium LLM prose.

---

## Open items to resolve before/early in implementation

1. **`resume` field choice** — confirm `resume` (vs `cv`/`pdf`) as the CV-map home; you flagged this tbd and a sentence was cut off ("The only —") — finish that caveat.
2. **`skill-synonyms` exports** — does it provide synonym→canonical mapping, or only stopwords? Gates the canonicalization effort.
3. **Per-job PDF filename scheme** — confirm job/skillset-scoped naming so it doesn't collide with `profile-{id}.pdf`.
4. **Cache invalidation** — confirm clear-CV-map-on-any-profile-write for v1.
5. **Kernel extraction** — confirm behavior-preserving refactor as a hard constraint (existing match scores unchanged).

---

A note on what this spec deliberately excludes, so it's explicit when you carry it into the new chat: there is no "ATS bypass," keyword-stuffing, fabricated-match, or seniority-masking behavior here. The CV trimmer omits irrelevant tail entries by relevance; it has no mode whose criterion is making a candidate look more junior than they are. Skill additions are user-asserted, never auto-claimed. Keeping those lines is what makes the tool defensible for the candidate (everything in the CV survives an interview) and for you.

That should be a clean handoff. Want me to trim it to just the implementation checklist for the new chat, or is the full version what you want to carry over?
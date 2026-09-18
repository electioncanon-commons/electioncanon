# ElectionCanon Architecture

This document describes the actual, current architecture — not an
aspirational design. Where something is planned but not built, it's
labelled as such explicitly.

## The one rule

**Rooms read, events write.**

No screen stores election state locally. An action (registering a
candidate, assigning a ward, sending a chat message, capturing a
simulated result) either publishes an immutable event to a shared,
tenant-scoped log, or — for a small number of operationally mutable
concerns like chat messages and campaign-studio drafts — performs a
directly RLS-protected read/write against its own table (see "Two kinds
of state" below). Every screen re-derives its own view by folding the
event log; nothing is cached client-side across reads.

## Tenant model

A **campaign** is the tenant boundary. It holds no election fact of its
own — only an id, a name, an `actor_kind`, and who created it. A
**campaign member** row (role, status) is what grants a user access to a
campaign's data at all. Every table that holds campaign data has a
Postgres row-level security policy scoped through a `SECURITY DEFINER`
helper function that checks *active* membership for the *calling* user —
never a client-supplied campaign id taken on its own word.

This pattern — a helper function like `is_active_campaign_member(uuid)`
rather than an inline self-referencing policy — exists because a naive
policy that queries its own table from within its own policy causes
Postgres error 42P17 (infinite recursion). Every new tenant-scoped table
follows this same helper-function pattern; see the migrations under
`supabase/migrations/` for the concrete SQL.

## Two kinds of state

**Canon facts** (candidate registration, ward assignment/status,
observer assignment, mobilization — people/assignments/tasks — and
Election Day — polling units/agents/results/incidents) are folded from
an append-only `election_events` table. Nothing here is ever updated or
deleted; a correction is a new event, and the fold's last-value-wins (or
history-array) semantics resolve the current state. This is genuinely
auditable: the full history of who reported what, and when, is
recoverable by re-folding the log.

**Operational state** that doesn't fit an immutable-log shape — chat
messages (need an unread-read cursor per user, per room), room
membership, and Campaign Studio design drafts (mutable in-place editing)
— lives in ordinary RLS-protected tables instead. These are direct CRUD,
not PREPARE/APPROVE — sending a chat message or saving a design draft
isn't a Canon fact requiring a human approval step the way a candidate
registration is.

## Write discipline: PREPARE → APPROVE → EXECUTE

Every Canon-fact write goes through three explicit steps, and no code
path can skip a step:

1. **PREPARE** — pure classification/validation of a proposed change
   against the current Canon view. No client is touched. Returns a draft
   describing exactly what would be recorded, with an explicit notice
   that nothing is recorded yet.
2. **APPROVE** — an explicit human action (a button click, never
   automatic) that re-resolves the caller's authentication, tenant
   membership, and write authority *independently* of what PREPARE found
   moments earlier — nothing about authorization is cached or trusted
   across the two steps.
3. **EXECUTE** — the only step that writes. Idempotent on a
   caller-supplied confirmation id: a duplicate submission is treated as
   a successful no-op, never a duplicate record or an error the user has
   to puzzle over.

This applies uniformly, including to any future AI-driven action: a
conversational interface may *prepare* a draft, but a human must still
approve it before it becomes a Canon fact. No silent AI writes.

## Actor-kind authority

A campaign declares one `actor_kind` (currently `candidate_campaign` or
`observer_organisation` have live readiness engines; several others are
declared in the type vocabulary but have no engine yet — offering a
choice in the UI that dead-ends is treated as worse than not offering it
at all). Each event type may declare a `REQUIRED_ACTOR_KIND` — a
candidate-registration event can only be authored by a
`candidate_campaign`, for example. This is enforced at write time by
re-reading the campaign's own persisted actor-kind from the database on
both PREPARE and APPROVE, never trusted from client input.

## Channel independence (web today, more channels planned)

Every write and read function is a plain, channel-agnostic function
taking an explicit `client` and structured fields — never a React hook,
never DOM access, never an assumption about the caller being a browser.
The web UI is one caller of this API surface. This is deliberate: a
future WhatsApp or voice channel adapter is meant to call the *same*
underlying operations, translating its own transport into the same
`{ client, fields }` calls, rather than re-implementing election
business logic per channel. No second channel exists yet — this is a
statement about how the existing code is already shaped, not a claim
that WhatsApp/voice integration is built.

## Multilingual design (English only today)

The conversational "Ask ElectionCanon" layer resolves an intent from a
per-language phrase table, then composes a response through a
per-language "realiser." Today only English has real phrase/response
tables; a request understood to be in another supported language falls
back to an English answer *and says so explicitly* (`fellBack: true`) —
this fallback behavior, not a fabricated translation, is what "prepare
the architecture without faking the capability" means concretely in this
codebase. Adding a new language is adding a new phrase table and
realiser, not restructuring the pipeline.

**Language-detection contract (corrected, Alpha 1.2).** An earlier
version of this paragraph described statistical language detection as
future work. That was wrong — it already exists and is already wired in:
`src/domains/election/studio/intent.js`'s `resolveIntent()` calls the
same `detectLanguage()` manufacturing uses (`src/os/studio/language.js`,
a marker-word statistical detector covering en/ha/yo/ig/pcm/fr/urh with a
confidence score and an explicit `uncertain` flag), then resolves the
actual response language via `resolveResponseLanguage({detected,
preferred, explicit})` with precedence **explicit in-message request >
the caller's declared `preferredLanguage` > a confident detection >
English default**. What genuinely remains future work is *phrase/
realiser coverage*: detection can recognise a message as Hausa today, but
`REALISERS` (`respond.js`) still only has a real English entry, so a
confidently-detected non-English message still answers in English with
`fellBack: true` — the fallback is a coverage gap, not a detection gap.
Detection confidence is never surfaced as a fabricated precise number in
the UI — only "recognised" or "fell back."

**Voice I/O boundary (updated, Alpha 1.2).** The boundary this paragraph
described is now real architecture, not just a plan: a Supabase Edge
Function (`supabase/functions/election-voice/`) and a client provider
module (`src/domains/election/channels/voiceProvider.js`) implement
exactly the shape below — speech-to-text happens *before* the pipeline
(producing the same plain-text `message` the Ask panel already sends —
voice is another channel adapter per "Channel independence" above, not a
parallel code path), and text-to-speech happens strictly *after*
`planElectionResponse` returns its answer text, reading that exact string
aloud. What is still genuinely absent: no voice vendor is configured
(`contract.mjs`'s provider registry is empty on purpose — see
[VOICE.md](./VOICE.md)), and no microphone-capture UI is wired
into any room yet — the Ask panel's mic button is present and honestly
disabled. No audio permission is ever requested by this codebase today.

## Simulation vs. real Election Day data

Every fact recorded by the Election Day workflow (polling units, agent
assignments, captured results, incidents) is a real, auditable Canon
event — but a captured "result" is explicitly marked `simulated: true`
by its own event schema, and every surface that renders Election Day
data carries a visible **SIMULATION / DEMONSTRATION DATA — NOT OFFICIAL
ELECTION RESULTS** label. As of Alpha 1.1, a result-sheet photo *is*
genuinely uploaded to a private, tenant-isolated Supabase Storage bucket
(`election-evidence`, RLS-scoped by campaign the same way every other
Canon table is) and the resulting path is recorded on the event —
persistence and tenant isolation are real. What remains simulated is the
*content*: a human still decides what a final field value is — OCR is
assistive, never authoritative (see below), and aggregation into an
official tally is still planned future work, not present capability.

**OCR (Alpha 1.2) — real, assistive, never authoritative.** A captured
result's evidence photo can be run through `src/domains/election/
electionDay/ocr.js` (a `provider.js`-shaped, never-throws abstraction) —
by default `ocrProviders/tesseract.js`, a genuinely working, entirely
client-side OCR engine (tesseract.js/WebAssembly; see
[OCR.md](./OCR.md) for exactly what is and isn't self-hosted).
The reading is recorded as its own immutable `RESULT_OCR_PROCESSED`
event — a SEPARATE fact from `RESULT_CAPTURED`'s human-entered
`extractedFields` and from `RESULT_VERIFIED`'s `verificationStatus`, so
"OCR ran" never implies "a human reviewed it." Every OCR-read field
carries a real confidence bucket (HIGH/MEDIUM/LOW/UNKNOWN — an
unrecognised or missing confidence is always coerced to UNKNOWN, never
guessed upward). A human reviewer then CONFIRMs or CORRECTs each field
via `proposeVerifyResult`'s `reviewedFields`, which preserves the
original `ocrValue` alongside whatever the human decided — a correction
is recorded, never a silent overwrite of what OCR actually read. The
public UI never names the OCR vendor ("Extract from image," not "powered
by tesseract.js") — the provider name is audit-trail metadata only.

**Result lifecycle stage (Alpha 1.3) — a derived label, never a third
source of truth.** `resultLifecycleStage()` in `electionDay/write.js`
combines the two REAL fields above (`ocr.status` and `verificationStatus`)
into one UI-facing word — `CAPTURED` / `OCR_COMPLETE` / `CONFIRMED` /
`CORRECTED` / `HUMAN_REVIEWED` / `DISPUTED` / `REJECTED` — so every
surface that shows a result's progress (the results list, Intelligence,
Ask ElectionCanon) reads the same computed answer instead of each
re-implementing its own if/else chain over the two raw fields. It
introduces no new Canon event or field; it is pure function output.

**Duplicate-evidence signal (Alpha 1.3) — a flag, never a block.**
`hashResultEvidence()` in `electionDay/evidence.js` computes a SHA-256 of
the uploaded photo's bytes, recorded as `evidenceHash` on the
`RESULT_CAPTURED` event. A caller can compare a new upload's hash against
already-recorded ones and surface a "this looks identical to an existing
result" note — but this NEVER refuses the write, because a legitimate
retake of the same real sheet can share a hash. Duplicate detection here
is advisory, not authoritative.

**Incident-to-result linkage (Alpha 1.3) — a reference, never an
accusation.** `INCIDENT_REPORTED` can optionally carry `linkedResult`,
validated only against a caller-supplied list of real result ids (the
same pattern as escalation-roster validation) — it lets an incident about
a disputed result point at that specific result, but ElectionCanon never
infers severity or wrongdoing from the link; it records evidence and
events, it does not declare criminality.

## Module layout

- `src/os/election{Scope,Bootstrap,Context,WebAdapter}.js` — the
  authentication/tenant-resolution boundary. `electionWebAdapter.js` is
  the *only* file the UI imports from to reach the Canon; it turns an
  authenticated Supabase session into a `userId`, never trusting one
  supplied any other way.
- `src/domains/election/events.js` — the canonical event-type vocabulary,
  required-field validation, and event factories.
- `src/domains/election/projections.js` — the fold: turns a tenant-scoped
  event log into the read model every screen renders.
- `src/domains/election/{studio,mobilization,electionDay}/write.js` —
  the PREPARE/EXECUTE pairs per operational area.
- `src/domains/election/{chat,design}/` — the two directly-RLS-protected
  (non-event-sourced) subsystems.
- `src/pages/Election.jsx` + `src/pages/election/*.jsx` — the web UI.

## What this document is not

This is not a security certification, a formal threat model, or a claim
of fitness for an official government election. See
[SECURITY.md](./SECURITY.md) for the security model and how to report a
vulnerability responsibly.

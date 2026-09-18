# ElectionCanon

**An operating system for preparing, coordinating and safeguarding
democratic elections.**

ElectionCanon is civic infrastructure for the full electoral operational
lifecycle: readiness, mobilization, coordination, communication, campaign
communications, election-day operations, and — eventually — result capture,
verification and audit. It is built for candidates, campaign organisations,
observer organisations, field teams, ward coordinators, polling-unit
agents, and civic organisations.

ElectionCanon is neutral infrastructure. It does not contain partisan
persuasion logic, and it does not claim to prevent election fraud by
itself — it builds a record that makes election operations more
transparent, auditable, and harder to manipulate quietly.

> **Status**: Alpha 1.7. This document describes what actually exists in
> the code today, distinguishing operational features from demonstration,
> preview and planned work. Nothing below is aspirational marketing copy.
> This repository was extracted from a larger monorepo it was originally
> built inside of (see "Provenance" below) — it is a standalone,
> independently buildable project, not a fork that still depends on that
> monorepo.

## Local setup

```bash
npm install
npm run dev       # http://localhost:5173 — demo mode with seed data if
                   # no Supabase credentials are configured
npm run build      # production build
npm test           # full test suite (plain Node scripts, no framework)
```

Copy `.env.example` to `.env` and fill in `VITE_SUPABASE_URL`/
`VITE_SUPABASE_ANON_KEY` to run against a real backend. `supabase/schema`
migrations under `supabase/migrations/` are the DDL to apply to a fresh
Supabase project to go live — see `docs/CONTRIBUTING.md`.

## Why this exists

Election preparation in most organisations happens across spreadsheets,
phone calls, and group chats with no shared, auditable record of who
committed to what, whether it happened, or what evidence backs a claim
of readiness. ElectionCanon replaces that with a single, tenant-isolated,
event-sourced record — a **Canon** — that every screen in the product
reads from and every action writes to, so "are we ready?" has an answer
grounded in real recorded facts rather than someone's memory.

## What is operational today (Alpha)

- **Readiness** — real, Canon-derived readiness claims (`COMPLETE` /
  `INCOMPLETE` / `AT_RISK` / `UNKNOWN`), never a fabricated percentage.
  Categories with no computed dimension are honestly labelled `NOT
  STARTED`, never silently shown as zero.
- **Campaign / workspace activation** — an authenticated user creates or
  joins exactly one campaign workspace; membership and role are enforced
  by database row-level security, not client-side trust.
- **Electoral geography** — Election, Office, State and Constituency
  selection, with LGA mapping where authoritative geography data exists.
- **Campaign organisation** — invite an LGA Coordinator, Ward Coordinator
  or Polling-Unit Agent by email, each landing directly in their own
  scoped workspace; every coordinator's territory is a real, assigned
  record, not a claim.
- **Mobilization** — people, wards, assignments and tasks, backed by real
  recorded events (not a static contact list).
- **Coordination chat** — real, persisted, tenant-scoped messaging with a
  National Coordination room auto-provisioned per campaign, plus
  campaign-created rooms.
- **Campaign Studio** — a template-based design workspace (21 templates:
  social posts, announcements, briefings, printable notices, ...) with a
  real save/edit cycle and client-side PNG export. No AI image generation
  is connected; the interface does not claim otherwise.
- **Election Day (simulation)** — polling units, agents, and a simulated
  result-capture → OCR → human review → confirm/correct/dispute →
  incident-report → escalation workflow, explicitly and consistently
  labelled **SIMULATION / DEMONSTRATION DATA — NOT OFFICIAL ELECTION
  RESULTS** everywhere it appears. Result-sheet photos ARE genuinely
  uploaded to private, tenant-isolated Storage and read via real
  client-side OCR (English only) — OCR is assistive only, a human always
  confirms or corrects every field, and OCR completing is never treated
  as verification. A SHA-256 duplicate-evidence signal flags
  likely-identical retakes without ever blocking a submission, and
  photos are compressed client-side before upload for low-bandwidth
  conditions.
- **Mobilization coverage** — agent coverage computed and shown by
  state → LGA → ward → polling unit, with an honest `null` (not `0%`)
  when there is no real denominator to compute a percentage from.
- **Ask ElectionCanon** — a conversational panel answering 15+ real
  operational questions grounded in the campaign's own Canon (readiness,
  ward status, coverage gaps, unresolved/high-priority incidents,
  evidence awaiting review, disputed results, polling units not
  reporting, and more). English only today; a non-English request is
  recognised and answered in English with that fact stated, never a
  fabricated translation.

## What is coming next (not yet built — not claimed as available)

- Election-day operational data collection at scale
- Multilingual conversational operation (Pidgin, Hausa, Igbo, Yoruba,
  Urhobo, ...) — the architecture is designed to support this without a
  rewrite (see [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)) and
  language detection is real, but no language pack has been reviewed/
  approved by a native or fluent speaker yet, so every response still
  realises in English
- Voice as a first-class input channel — one speech provider (Google
  Cloud Speech-to-Text, English/Hausa/Yoruba/Igbo) is registered in code
  against the real API reference, but no deployment of this project has
  ever configured a live key for it; no text-to-speech provider exists at
  all; see [docs/VOICE.md](./docs/VOICE.md)
- A WhatsApp channel calling the same underlying operations as the web app
- Invite-only (rather than open campaign-wide) chat room membership
- Official election-result integration — Election Day remains and will
  remain explicitly simulated until a legitimate official integration
  exists

## Core architecture, in one sentence

**Rooms read, events write.** No screen stores election state directly;
every action publishes an immutable, tenant-scoped event to an append-only
log (the Canon), and every view is a pure fold over that log — see
[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the full model and the
event vocabulary.

Consequential writes go through an explicit three-step discipline:
**PREPARE** (classify and validate, no side effects) → **APPROVE** (an
explicit human action) → **EXECUTE** (the only step that writes,
idempotent on a caller-supplied confirmation id). Nothing in this product
writes silently, including the AI panel — see
[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md#write-discipline).

## Security & tenant isolation

Every table is protected by Postgres row-level security scoped through an
active-membership check, not a client-supplied identifier. See
[docs/SECURITY.md](./docs/SECURITY.md) for the full model and how to
report a vulnerability.

## Development

See [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) for local setup and how
to propose a change. Tests are plain Node scripts (no test framework) —
run the full suite with `npm test`, or a single suite directly, e.g.
`node test/election-readiness.consumer.mjs`.

## License

ElectionCanon is licensed under the [GNU Affero General Public License
v3.0](./LICENSE) (AGPL-3.0). In short: you may use, study, modify and
redistribute this software freely, including running it as a network
service — but if you modify it and make the modified version available
to users over a network, you must make your modified source available to
those users too. This choice is deliberate for election infrastructure
specifically: it exists to prevent a closed-source fork of civic
election tooling being used against the public interest it's meant to
serve.

## What this is not

ElectionCanon is not a certified election-management system. It has not
been independently audited, and it makes no claim of suitability for an
official government election until that certification and legal review
has genuinely happened. Election Day features described above as
"simulation" are exactly that — demonstration data, never real results.

## Provenance

ElectionCanon was originally built as a component of a larger civic-tech/
manufacturing-coordination monorepo, sharing that project's authentication
and design-system infrastructure. This repository is a standalone
extraction (Alpha 1.7) of the complete, independently working ElectionCanon
implementation — its own routes, its own domain logic, its own database
schema, and its own copy of the small set of shared infrastructure it
genuinely needs (authentication client, the conversational-response
engine, design tokens). It builds, tests, and runs with zero dependency on
the original monorepo. See [docs/RELEASE.md](./docs/RELEASE.md) for the
full extraction record.

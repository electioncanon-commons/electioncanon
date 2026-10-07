# Contributing to ElectionCanon

Thanks for considering contributing. This document covers local setup,
how tests work in this codebase (it's unusual — read this before writing
one), and what to expect from the review process.

By participating, you're agreeing to follow the
[Code of Conduct](./CODE_OF_CONDUCT.md).

## Local setup

```bash
npm install
npm run dev       # http://localhost:5173
npm run build      # production build
npm test           # full test suite
```

Copy `.env.example` to `.env` and fill in `VITE_SUPABASE_URL` /
`VITE_SUPABASE_ANON_KEY` to run against a real backend. `isConfigured` in
`src/lib/supabase.js` gates every live call: without configured
credentials, the application does not fabricate a signed-in identity or
campaign workspace — there is no fake signed-in user, since a demo
identity would be a lie about who is accountable (see
`src/os/ForgeIdentity.jsx`'s own header). It still runs and is useful for
most UI or domain-logic changes, but the authenticated Election workspace
itself requires a real backend configuration. A separate synthetic
demonstration environment may be provisioned explicitly against a real
backend; it must not be confused with a real campaign.

## How tests work here (important — read before writing one)

**There is no test framework.** No Jest, no Vitest, no Mocha. Every file
under `test/*.consumer.mjs` is a plain, self-executing Node script that
prints `ok`/`FAIL` lines and exits non-zero on any failure. `npm test`
runs a **fixed, hand-maintained list** of these scripts — it is not a
glob. If you add a new test file, you must also add it to the `test`
script in `package.json`, in the same `node test/your-file.consumer.mjs
&&` chain style as the existing entries.

Run a single suite directly while iterating:

```bash
node test/election-readiness.consumer.mjs
```

**Tests are honestly labelled by what kind of evidence they actually
are.** Most Election tests use a fake, in-memory Supabase client (a
handful of `.from().select().eq()...` methods implemented by hand) —
this is explicitly disclosed in each file's header as MOCK evidence, not
a live-database test. `test/election-web-surface.consumer.mjs` is a
different kind entirely: literal source-text pattern matching against
`Election.jsx` (via a shared comment-stripping tokenizer,
`test/lib/source.mjs`) — this exists because the repo has no
React-rendering test harness, so architectural invariants ("the UI only
ever reaches the Canon through one adapter file," "PREPARE can never
reach EXECUTE directly") are proven at the source-text level instead.
If you add a new structural test in this style, follow the existing
pattern: isolate the specific function body you're checking with a
regex before asserting against it, rather than asserting against the
whole file — otherwise an unrelated change elsewhere in the file can
silently break your check for the wrong reason.

**A known hazard**: the comment-stripping tokenizer treats any bare `'`
as a string-open delimiter. A raw apostrophe in JSX text or a comment
(e.g. "doesn't") that isn't inside a real string literal will make the
tokenizer misinterpret everything after it as string content until the
next stray `'`, silently deleting real code from what gets checked. If
you're adding UI copy in a file covered by a structural test, avoid
contractions with bare apostrophes, or use a typographic apostrophe
(`'`) instead.

## Reviewing a language pack

Each language lives under `src/os/studio/<language>/` (e.g. `pidgin/`,
`hausa/`, `yoruba/`, `igbo/`, `urhobo/`) as `lexicon.js`, `technical.js`,
`phrases.js`, `questions.js`, `responses.js`, and `coverage.js`. Every
entry (a word, a technical term, a sentence pattern) carries the same
shape: `{ english, <language>, source, confidence, approved, note }`.
**`approved` starts `false` on every entry, everywhere, always** — this is
the one invariant a language-pack PR must never touch, because it is what
keeps unreviewed content out of the UI's `VERIFIED` state (see
`src/os/studio/languageCapability.js`, and `test/language-capability.
consumer.mjs`'s §A for the tests that prove it). Flipping `approved` to
`true` is a fluent-speaker's call, not a contributor's or a maintainer's —
if you're proposing new entries, leave `approved: false` and let a native
or fluent reviewer make that call in review.

What to check when reviewing a language-pack PR:

- **Every entry names a real `source`.** `SOURCES` in that language's
  `lexicon.js` enumerates what's acceptable — a cited dictionary/
  phrasebook (highest confidence), or an honestly-labelled lower tier like
  Pidgin's `COMMON_USAGE`/`SELF_ASSESSED` ("asserted, not independently
  corroborated"). A source of `"not researched"` is fine; a source that's
  just made up to fill the field is not — if you can't tell which, ask the
  contributor where the word actually came from.
- **`confidence` matches the source honestly.** A word from a cited
  phrasebook is `WEB_SOURCED` (or that language's equivalent top tier); a
  word the contributor is confident about but can't point to a source for
  is the lower, explicitly-uncorroborated tier — never the top tier
  because it "seems obviously right." (Pidgin's own header comment on this
  exact point is a good model: "what seems obvious can still be wrong.")
- **No entry is silently reused across unrelated concepts.** Each `note`
  field should make it clear a term was checked in context (an example
  sentence, a usage note), not pattern-matched from a similar-looking
  English word.
- **`coverage.js` is counted, not hand-edited.** `lexiconCoverage()`/
  `i18nCoverage()` compute real numbers by iterating the actual entry
  arrays — never add a hardcoded percentage or count anywhere in a
  language pack; if a number looks wrong, the entries are wrong, not the
  formula.
- **Run the tests that exist for exactly this.**
  `test/language-capability.consumer.mjs` and (for Pidgin specifically)
  `test/language.consumer.mjs`/`test/urhobo.consumer.mjs`'s sibling
  pattern prove unreviewed content can never report as `VERIFIED` and that
  an unsupported/unapproved language falls back to English honestly. If
  you're adding a NEW language directory, follow an existing one's file
  shape exactly rather than inventing a new one.

Approving an entry (flipping `approved: true`) should only happen after a
fluent or native speaker has actually read it in context — a maintainer
merging a PR is not itself that review, and a PR that flips `approved` on
entries without saying who reviewed them and how should be sent back for
that context before merge.

## Protecting the Canon

Before touching anything under `src/os/election*.js` or
`src/domains/election/`, read [ARCHITECTURE.md](./ARCHITECTURE.md). The
short version: don't casually modify row-level security, the
PREPARE/APPROVE/EXECUTE write discipline, or tenant-scoping logic. If a
change genuinely requires touching one of these, explain why in your PR
description — a maintainer will want to understand the reasoning before
merging, not just the diff.

## Commit and PR conventions

- Keep PRs scoped to one change. A bug fix doesn't need accompanying
  refactors; a new feature doesn't need to "clean up" unrelated code
  along the way.
- Write commit messages that explain *why*, not just *what* — the diff
  already shows what changed.
- Run `npm test` and `npm run build` before opening a PR. Both must pass.
- If your change touches a database migration, include the migration
  file and explain what it does and why the existing pattern (see other
  files under `supabase/migrations/`) was or wasn't followed.

## What we're not looking for right now

- Rewrites of the event-sourcing model "for cleanliness" — see
  [ARCHITECTURE.md](./ARCHITECTURE.md) for why it's shaped the way it is
- New dependencies for things a small amount of existing code already
  does
- Partisan political logic of any kind — see the README's neutrality
  principle

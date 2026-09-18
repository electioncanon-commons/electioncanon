# ElectionCanon — Standalone Release Manifest & Checklist

This document is the single place that answers "is this standalone
ElectionCanon repository ready to publish, and what exactly remains for
the owner to do." It describes THIS repository only — a standalone
extraction, with its own clean git history, independent of the larger
monorepo it was originally built inside. Re-read, don't blindly trust,
the next time this question comes up — re-verify anything time-sensitive
(GitHub visibility, docs accuracy) rather than assuming it's still true.

## Extraction record (Alpha 1.7)

- **Source**: extracted from `fatt-app` (a larger civic-tech/
  manufacturing-coordination monorepo), commit `763e0755ecf96caeb2906a2a6
  cce3101ff49d195` on that repository's `main` branch, dated 2026-08-28.
  That repository is not public and is not this project's canonical
  home — it is cited here only for provenance.
- **This repository's history**: starts clean at commit `30b9a78`
  ("ElectionCanon Alpha 1.7 — standalone extraction"), followed by
  `017da7c` ("fix: force LF line endings via .gitattributes"). No commit
  from `fatt-app`'s history was copied — `.git` was never copied, and
  this repository's own history was created fresh, containing only
  Election-relevant source.
- **What was extracted**: the complete, working ElectionCanon
  application — routes, domain logic, database migrations, Supabase
  Edge Function, tests, and documentation — plus the small set of shared
  infrastructure it genuinely depends on, copied into this repository
  (authentication client, the conversational-response engine and its
  language packs, design tokens/CSS). Files that mixed real Election
  logic with unrelated manufacturing logic were trimmed in place
  (`src/lib/supabase.js`, `src/os/ForgeRuntime.js`); files where the
  manufacturing-specific code was an unreachable dead branch were copied
  unchanged and given small local stub dependencies instead
  (`src/os/studio/terms.js`, `intent.js`, `infer.js` and their
  manufacturing-state imports) so the shared engine loads standalone
  without needing any real manufacturing data. `src/pages/Access.jsx`
  and `src/App.jsx` were rewritten to contain only the Election path —
  see their own header comments for exactly what was removed.
- **Tests**: 642/642 passing, verified against a fresh `git clone` of
  this repository (not just the working copy), confirming the test
  suite does not depend on anything outside this repository. **Build**:
  clean, single-entry Vite build (`npm run build`) producing one
  `dist/index.html` for the one product this repository contains — no
  multi-entry configuration is needed here, unlike the monorepo this was
  extracted from.

## Release checklist

- [x] Product functionally real, no dead buttons — Alpha 1.0-1.7 UI/
      behavior preserved unchanged from the source monorepo, where it was
      verified live through the real browser UI
- [x] Independent build — `npm install && npm test && npm run build`
      succeeds from a clean clone with the original monorepo unavailable
      as a dependency (verified: fresh clone in a separate directory,
      zero references resolved outside this repository)
- [x] No `fatt-app`/Forge-A-Truck/manufacturing runtime dependency —
      confirmed via `package.json` (only npm packages Election code
      actually imports are listed) and a repo-wide grep for
      `fatt-app|forgeatruck|forge-a-truck|nawedoam`, reviewed file by
      file (see "Independence audit" below)
- [x] No manufacturing/Forge-A-Truck leakage in the ElectionCanon UI
      itself (inherited from the source monorepo's own Alpha 1.4 audit;
      nothing in this pass's extraction touched UI copy)
- [x] Simulation/official-result boundary — no overclaiming copy;
      unchanged from the source implementation
- [x] Reproducible line endings — `.gitattributes` (`* text=auto
      eol=lf`) added after a fresh clone on this Windows machine
      revealed CRLF conversion broke a structural test; re-verified
      clean (642/642) from a subsequent fresh clone
- [x] OSS docs (LICENSE/README/ARCHITECTURE/SECURITY/CONTRIBUTING/
      CODE_OF_CONDUCT/VOICE) present at repository root, reviewed for
      this repository's own context (relative links, "Provenance"
      section in README.md added to explain the extraction honestly)
- [x] **Independent public repository** — resolved. The repository
      now lives at `electioncanon-commons/electioncanon`, a GitHub
      organisation with no Forge branding or ownership, distinct from
      `forge-manufacturing-commons` (verified: that org was not moved,
      renamed, or touched). The "View source on GitHub" footer link in
      `src/pages/Landing.jsx` points at the real, independent URL and
      has been verified live. `main` was pushed and re-verified against
      the real GitHub remote, not just a local clone.
- [x] **GitHub repository visibility** — public (verified via the
      GitHub API: `"visibility": "public"`).
- [ ] **Real mobile-device/DevTools verification** — not attempted in
      this extraction pass. The source monorepo's own release-readiness
      work recorded this as blocked by browser-automation tooling
      (`window.innerWidth` not changing after `resize_window`) across
      four independent attempts; that finding is about the tooling, not
      this repository's code, so it is restated here rather than
      re-attempted.
- [ ] **Domain purchase + attachment** — not done, not attempted, out of
      scope for this extraction pass (this repository directive
      explicitly excludes domain cutover — see cutover checklist below).

## Rollback instructions

This repository has two commits total, both part of the initial
extraction:

1. `git reset --hard 30b9a78` would remove the `.gitattributes` line-
   ending fix (`017da7c`) — not recommended, since that fix addresses a
   real reproducibility bug; there is no reason to roll it back.
2. There is no prior published state to roll back to — this is the
   first release of this repository. "Rollback" for this pass means: do
   not push to GitHub until the checklist above is cleared.

## Domain cutover checklist (deliberately not started)

No domain-redirect or hostname-detection logic exists anywhere in this
repository's `src/App.jsx` — unlike the source monorepo (which had to
route between two products by hostname/path), this repository serves
exactly one product at its root (`/` redirects to `/election`), so no
per-domain branching is needed for the app to work correctly once a
domain is attached. Nothing here is "dormant code waiting for DNS"; a
domain can be pointed at this deployment with no code changes required
first.

**Still needed, in order, all owner/account actions, none attempted by
this extraction pass**:

1. **Domain registration** — purchase the chosen domain (e.g.
   `electioncanon.org`) from a registrar. Not done.
2. **Hosting/deployment** — this repository has no deployment
   configuration of its own yet (no `vercel.json` — the source
   monorepo's was written for its two-product routing and does not
   apply here). Choose a host and deploy `npm run build`'s `dist/`
   output as a static single-page app with a catch-all rewrite to
   `index.html` (standard Vite SPA hosting; exact config depends on the
   chosen host). Not done.
3. **DNS configuration** — point the domain's DNS at the chosen host
   per that host's own instructions. Not done.
4. **HTTPS** — provisioned automatically by most static hosts once DNS
   resolves correctly; no separate action beyond choosing a host that
   does this.
5. **Canonical hostname / www vs. non-www** — decide which is
   canonical and configure that redirect at the host level. Not
   decided.
6. **Authentication redirect behaviour** — Supabase Auth's email
   templates/redirect URLs (password reset, magic link, email
   confirmation) are configured with an allow-list of redirect URLs in
   the Supabase dashboard (Authentication → URL Configuration). Whatever
   domain this repository is deployed to must be added to that
   allow-list, or auth emails will redirect incorrectly. Requires
   Supabase project dashboard access — not done from this session, and
   depends on which Supabase project this repository is ultimately
   pointed at (see "Database dependency" below).
7. **Open Graph URL** — `index.html`'s `og:title`/`og:description` have
   no `og:url` set (correctly — no canonical URL is live yet). Add
   `<meta property="og:url" content="...">` once a domain is attached.
8. **robots/sitemap** — none exist yet; decide once a real public
   domain exists.

## Database dependency (explicit, not hidden)

This repository preserves ElectionCanon's database architecture exactly
(migrations under `supabase/migrations/`, RLS, event schema) but does
not itself provision a Supabase project. Two honest options going
forward, neither decided by this extraction pass:

- Point this repository at a **new, dedicated Supabase project** (apply
  the migrations in this repo to a fresh project) — full data isolation
  from the source monorepo's own Supabase project, recommended for a
  genuinely independent product.
  - Bring your own real Supabase project: sign in and connect it,
    then this environment's Supabase tools can create a project and
    apply these migrations directly.
- Continue pointing at the **same Supabase project** the source
  monorepo uses, via this repository's own `.env` credentials — works
  immediately (schema is unchanged), but means this repository and the
  source monorepo share a live database, which is a real coupling this
  document should not hide even though it isn't a code dependency.

Whichever is chosen, `.env.example` documents the two variables needed
(`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).

## Independence audit (this extraction pass)

Repo-wide grep for `fatt-app|forgeatruck|forge-a-truck|nawedoam`
(excluding `node_modules`) returned matches in 10 files; every match was
read individually. All 10 are either explanatory provenance comments
this extraction deliberately wrote (documenting what was extracted from
where and why, or why a stub file is empty), or the README's
"Provenance" section — none are functional imports, none are
user-visible branding, and none create a runtime or build-time
dependency on the source monorepo. No accidental coupling was found.

Independent clone/install/test/build was verified twice: once
immediately after the initial extraction commit, and once again after
the `.gitattributes` fix, both from a fresh `git clone` of this local
repository into a separate directory with the source monorepo absent
from that directory's ancestry.

## GitHub publication steps (once the above are cleared)

**Status: completed.** The repository was created at
`electioncanon-commons/electioncanon` (public) and pushed; steps below
are kept as the historical record of what was done, not as outstanding
work.

1. Create the repository (see "GitHub repository creation + push"
   above) — owner action, blocked in this session by missing tooling.
2. Push this repository's existing two-commit history as-is. It already
   contains no `fatt-app` history and no sensitive artifacts, so no
   history-cleanup step is needed here (unlike the source monorepo,
   which has its own separate, unresolved history-cleanup question that
   does not apply to this repository).
3. Decide public vs. private visibility. Recommend private until the
   remaining checklist items above (mobile QA, domain/database
   decisions) are resolved, then flip to public deliberately.
4. After pushing, re-run the full test suite and build against the
   pushed history from a fresh clone of the real GitHub remote (not
   just a local clone), so the published state is verified, not
   assumed.

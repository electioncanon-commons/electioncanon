# Security Policy

ElectionCanon handles election-preparation data for real organisations.
We take reports of security issues seriously and will respond promptly.

## Reporting a vulnerability

**Please do not open a public GitHub issue for a security vulnerability.**
A public issue discloses the problem to potential attackers before a fix
ships.

Instead, use **GitHub's private Security Advisory feature** on this
repository (`Security` tab → `Report a vulnerability`), which opens a
private conversation with maintainers before any public disclosure. If
that isn't available to you, contact a maintainer directly through
whatever private channel you have and ask for a secure way to share
details.

When reporting, please include:

- What you found and why it's a security issue (not just "this seems
  wrong")
- Steps to reproduce, if you have them
- The potential impact — could it expose one tenant's data to another
  campaign, escalate a role, bypass the PREPARE/APPROVE/EXECUTE write
  discipline, or something else
- Whether you've already tested this against a live deployment (please
  don't, beyond the minimum needed to confirm the issue — see "Testing
  boundaries" below)

We aim to acknowledge a report within a few days and will keep you
updated as we work on a fix. We'll credit reporters who want credit,
once a fix has shipped.

## What we consider in scope

- Any way one campaign's data (Canon events, chat messages, mobilization
  records, Campaign Studio assets) becomes readable or writable by a
  user who is not an active member of that campaign
- Any way row-level security can be bypassed from the browser client
- Any way the PREPARE → APPROVE → EXECUTE discipline can be skipped,
  duplicated destructively, or spoofed (e.g. forging `userId` or
  `actor_kind` from client input)
- A service-role or other privileged credential reachable from browser
  code
- Authentication bypass, session fixation, or privilege escalation

## What's explicitly out of scope right now

- The Election Day "simulation" data being fictional — that's the
  intended, disclosed behavior this phase, not a bug (see
  [ARCHITECTURE.md](./ARCHITECTURE.md))
- Missing features described in the README as "coming next"
- Denial-of-service issues requiring resources beyond what a normal
  developer could reasonably test with (please still report anything you
  find; we just don't expect you to prove it at scale)

## The security model, briefly

- **Tenant isolation**: every table holding campaign data is
  RLS-protected via a `SECURITY DEFINER` active-membership check, never a
  client-supplied campaign id taken on trust. See
  [ARCHITECTURE.md](./ARCHITECTURE.md) for the full model.
- **No privileged credentials in the browser**: the client only ever
  holds a Supabase anon key, whose access is entirely governed by RLS.
  Every migration that adds a new database function explicitly revokes
  the default `anon` execute grant Postgres/Supabase applies automatically,
  after granting only to `authenticated`.
- **Idempotent, attributed writes**: every write is tied to the
  authenticated caller's own session-derived identity (never a
  client-supplied user id) and de-duplicated on a caller-supplied
  confirmation id at the database's own unique-constraint level, not just
  client-side.

## Threat model, briefly

Who we're defending against, and what each control is actually for —
useful context before reporting an issue or reviewing a PR that touches
security-relevant code.

- **A campaign member of one campaign, trying to read or write another
  campaign's data.** The primary threat this system is built around —
  every table is RLS-gated by active membership (see "The security model"
  above), and this is the class of issue every fake-client `OWNER_A`/
  `OWNER_B` consumer test and every live Storage/PostgREST spot-check in
  this repository's test history exists to catch. **Not** defended
  against by hiding campaign ids — they are treated as public-ish
  identifiers; the RLS policy, not obscurity, is the control.
- **An unauthenticated caller with no Supabase session at all.** Blocked
  at the platform layer before any application code runs — every Edge
  Function relies on Supabase's default `verify_jwt = true` (no
  `supabase/config.toml` in this repository opts any function out of it;
  see VOICE.md's security notes for the specific confirmation done for
  `election-voice`), and every table's RLS policy requires
  `is_active_campaign_member()`, which itself requires `auth.uid()` to
  resolve to a real session.
- **A malicious or buggy language model output**, reached through
  `election-voice`'s live-escalation path or a future model integration.
  Treated as untrusted input, never as an instruction: model output can
  only ever supply candidate TEXT for a claim already grounded in the
  real Canon fold, or a candidate write draft that still requires every
  one of the SAME validations a human-typed request goes through (see
  [ARCHITECTURE.md](./ARCHITECTURE.md#write-discipline-prepare--approve--execute)'s
  write-discipline section). A model can never invent a Canon fact, name
  a write field the human didn't supply, or skip PREPARE → APPROVE.
- **A compromised or overly-broad browser credential.** The browser only
  ever holds a Supabase anon key; every privileged operation (service-role
  actions, if any are ever added) must live server-side. This is checked,
  not assumed — see "What we consider in scope" above.
- **Explicitly NOT this system's threat model right now**: a
  state-level adversary attempting to compromise INEC's own official
  results infrastructure. ElectionCanon does not integrate with INEC/IReV
  and makes no claim to protect or authenticate official results — see
  `ARCHITECTURE.md`'s evidence-architecture section. Every "verified"
  label in this product means "a human confirmed this against a photo,"
  never "this is the certified outcome."

## How to review a language pack

See `CONTRIBUTING.md`'s "Reviewing a language pack" section — the review
concerns (source citation, no fabricated translation, `approved` staying
`false` until a fluent reviewer signs off) are a content-integrity
question more than a security one, so the full checklist lives there
rather than being duplicated here.

## How voice providers are configured

See `VOICE.md`'s "How voice providers are configured" and "Security
notes" sections — covers where the credential lives (server-side only,
Edge Function environment, never `.env`/the browser bundle), what
`resolveProfile()` in `contract.mjs` checks before any vendor call is
attempted, and the confirmation that `election-voice` is gated by
Supabase's unmodified, platform-level `verify_jwt` default — the same
default every Edge Function in this repository relies on, with no
`supabase/config.toml` anywhere in the tree opting any function out of
it.

## Git history

This repository's full history has been checked for committed secrets
(API-key-shaped strings across the major vendor formats, JWT-shaped
tokens, and a tracked `.env`/`.env.local` file) — none were found; the
only environment-variable file ever tracked is `.env.example`, which
holds no real values. This check is re-run periodically as the codebase
grows, not a one-time claim.

## Testing boundaries

If you're testing against a real deployment rather than a local/self-hosted
instance, please use disposable test accounts and disposable test
campaigns, and avoid touching any data you don't recognise as your own
test fixture. If you're unsure whether an account or record is real user
data, treat it as real and stop.

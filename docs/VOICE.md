# ElectionCanon — Voice Input/Output

## Status: one real provider profile registered, genuinely `NOT_CONFIGURED` by default

Voice has a working request/response boundary end-to-end: a real Supabase
Edge Function (`supabase/functions/election-voice/`), a real client-side
provider module (`src/domains/election/channels/voiceProvider.js`), and a
real, honestly disabled "Voice · soon" affordance in the Ask ElectionCanon
panel. Alpha 1.2 shipped this boundary with `contract.mjs`'s
`PROVIDER_PROFILES` registry genuinely empty. Alpha 1.3 compared five
candidate speech providers against language coverage, accent quality,
latency, cost, privacy, and public-documentation availability (see
"Provider comparison" below) and registered exactly ONE real profile:
**Google Cloud Speech-to-Text (Chirp/Chirp 2), STT only, for
English/Hausa/Yoruba/Igbo.** Registering the profile is not the same
claim as it being live in any given deployment — it still resolves to
`PROVIDER_NOT_CONFIGURED` unless an operator explicitly sets
`ELECTION_VOICE_PROVIDER=google_stt` plus the two environment values
below. No text-to-speech provider exists for any language, and no
provider of either kind exists for Pidgin or Urhobo — see "What is
explicitly out of scope this phase."

## Provider comparison (Alpha 1.3, sourced)

| Provider | ha/yo/ig STT | Pidgin STT | Any TTS (ha/yo/ig/pcm) | Implementable without guessing |
|---|---|---|---|---|
| **Google Cloud Speech-to-Text** | Yes — `ha-NG`/`yo-NG`/`ig-NG` officially listed | No | No | **Yes** — official, versioned REST reference |
| Azure Speech | No (locale table has no ha/yo/ig/pcm) | No | No | N/A |
| Orinode (Nigeria-specific) | Yes, claimed | Yes, claimed | Not shipped (pilot/early-access only) | No — no public wire-format reference |
| 9jaLingo | Claimed | Claimed | Claimed | No — homepage only, no accessible API spec |
| Spitch | Claimed (ha/yo/ig/en) | Not mentioned | Claimed | No — homepage only, no accessible docs |

The three Nigeria-specific specialists have stronger claimed language
coverage but none had, at review time, a public request/response
specification precise enough to implement against without inventing
shapes — this codebase's standing rule ("every wire-format field is read
from the official reference, never remembered") ruled them out for this
pass, not their coverage. Revisit if any of them publish real API docs.

## Architecture

```
MICROPHONE (browser capture — not yet wired into any UI component)
  -> speech-to-text (election-voice Edge Function, op: "stt")
  -> the SAME plain-text `message` the Ask panel already sends
  -> LANGUAGE DETECTION -> INTENT -> ELECTIONCANON ACTION -> RESPONSE
  -> text-to-speech (election-voice Edge Function, op: "tts"),
     reading back planElectionResponse's EXACT answer text
  -> SPEAKER
```

This matches `ARCHITECTURE.md`'s pre-existing "Voice I/O boundary"
paragraph exactly: speech-to-text produces the same `message` string the
Ask panel's text input already sends (voice is a channel adapter, not a
parallel understanding path), and text-to-speech reads the already-
composed answer aloud rather than generating a second, unverified
response.

## No secret in the browser

Exactly like `src/os/studio/provider.js` (the text-AI provider) and
`supabase/functions/forge-ai/`: whatever voice-vendor API key eventually
exists lives only in the Edge Function's environment
(`ELECTION_VOICE_PROVIDER_KEY`, matching the `FORGE_AI_PROVIDER_KEY`
naming precedent) and is never shipped to the browser bundle. The
provider is selected by environment variable
(`ELECTION_VOICE_PROVIDER`), never by anything the client sends — the
same discipline that keeps a caller from choosing which vendor's key
gets used.

## Voice safety

Per this product's own principle ("voice must not silently execute
sensitive actions"): `transcribe()` only ever produces plain text that
populates the SAME input box a human can already read, edit, and cancel
before it goes anywhere. Nothing in `voiceProvider.js` calls a PREPARE or
APPROVE function directly — a transcribed sentence still goes through the
exact same PREPARE → APPROVE flow as typed text, meaning a sensitive
action (a result submission, a status change, an incident escalation)
still requires the same explicit human "Approve" click voice cannot
bypass. This is not new voice-specific logic — it falls out for free from
the fact that ElectionCanon never auto-executes any write, regardless of
input channel.

## What is explicitly out of scope this phase

- No microphone capture UI exists yet — the Ask panel's mic button is
  disabled and says so plainly.
- No text-to-speech provider exists for any language — `op: "tts"` always
  refuses `PROVIDER_NOT_CONFIGURED`, unconditionally, even if a future STT
  provider is configured (see `index.ts`'s explicit check for this).
- No Pidgin or Urhobo voice support, STT or TTS — `google_stt`'s
  `sttSupportedLangs` deliberately excludes them (Google's own
  supported-languages table lists neither locale); a request for either
  is refused `UNSUPPORTED_LANGUAGE` before any network call is attempted,
  never silently downgraded to English audio.
- No live-tested call to Google's API from this repository — the profile
  is real and verified against the official reference, but no
  `ELECTION_VOICE_PROVIDER_KEY` has ever been set in this project's own
  deployments.

## How voice providers are configured (operator-facing)

To enable Google Cloud Speech-to-Text in your own deployment, set three
Edge Function environment variables (`supabase secrets set ...`, or your
platform's equivalent) — never in `.env`/the browser bundle. This is
standard Supabase Edge Function secret-handling practice, and the same
pattern this repository follows everywhere else a provider credential
exists:

- `ELECTION_VOICE_PROVIDER=google_stt`
- `ELECTION_VOICE_PROVIDER_KEY` — a valid OAuth2 access token for a
  Google Cloud service account with Speech-to-Text access, scope
  `https://www.googleapis.com/auth/cloud-platform`. **This is a
  short-lived token, not a static API key** — Google's v2 Speech API
  requires a bearer token, and this repository does not implement the
  service-account JWT-bearer exchange that mints one (see
  `contract.mjs`'s `google_stt` profile comment for the full reasoning).
  You are responsible for refreshing this value on whatever schedule your
  token's lifetime requires (a scheduled `gcloud auth print-access-token`
  job, or an equivalent token-minting sidecar).
- `ELECTION_VOICE_GOOGLE_PROJECT_ID` — the Google Cloud project id the
  recognizer endpoint is built against.

Missing any one of these three resolves to `PROVIDER_NOT_CONFIGURED`
(`resolveProfile()` in `contract.mjs` checks all three explicitly, with a
distinct reason string per missing value) — never a silent partial
configuration, and never a fallback to a different, unrequested provider.

Adding a second/different provider means writing a new `PROVIDER_PROFILES`
entry with every field read from that vendor's own official reference (not
remembered or guessed), following the `google_stt` entry as the template —
see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Security notes

- No new database table, no new Storage bucket — this capability adds
  exactly one new Edge Function and three new (unset by default)
  environment secret slots.
- `contract.mjs`'s request validators (`validateSttRequest`/
  `validateTtsRequest`) enforce size and MIME-type limits before any
  provider is even consulted, so a malformed or oversized request is
  refused at the boundary regardless of vendor.
- **Platform-level authentication does not depend on any hand-written
  code in this repository.** `election-voice/index.ts` contains no
  hand-written JWT verification code, and this repository defines no
  `supabase/config.toml` anywhere in its tree to disable Supabase's
  per-function default (`verify_jwt = true`) — confirmed by reading the
  file and the repository tree directly, not assumed. Once deployed, a
  request with no valid Supabase-issued Authorization bearer token is
  rejected by the platform before the function body ever runs. This is
  entirely a property of ElectionCanon's own code and Supabase's
  platform default — it requires no other infrastructure to be true.
- **Live-deployment status, checked directly (Alpha 1.3):**
  `election-voice` returned `404 NOT_FOUND` when checked against this
  project's Supabase instance — it has never been deployed here
  (`supabase functions deploy election-voice` has not been run). The
  source-level guarantee above still holds and will apply automatically
  once it is deployed, but this is stated as what it is: a source
  guarantee, not yet a live-observed one for `election-voice` itself.
  During Alpha development, the same unmodified Supabase default was
  separately observed live-in-practice — a real
  `401 UNAUTHORIZED_NO_AUTH_HEADER` response to an unauthenticated
  request — against a different Edge Function that happened to be
  reachable in the same deployment environment at the time. That
  function is **external infrastructure ElectionCanon does not own,
  control, or currently depend on**; it was cited only as corroborating
  evidence that Supabase's default genuinely rejects unauthenticated
  requests in practice, not merely in documentation. It is not a
  dependency this product carries forward, and no ElectionCanon
  deployment requires it to exist.

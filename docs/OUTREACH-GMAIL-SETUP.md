# Outreach Gmail Integration — Manual Setup (Launch Engine closed-loop, Phase 4)

**Status: not configured.** `supabase/functions/outreach-gmail/` is fully implemented against the real Gmail API, but every action in it checks for four secrets first and refuses with `GMAIL_OAUTH_NOT_CONFIGURED` if any are missing. None currently exist on this project (verified via `supabase secrets list` on 2026-10-14). This document is the exact, complete list of what a project owner needs to do to turn this on — nothing here can be done by an automated session, since it requires a Google account with access to create a Cloud project and generate credentials.

## What you're setting up

A Google Cloud OAuth2 client that lets this project send and read mail through **one specific Gmail mailbox** (recommended: `sotinnovate@gmail.com`, since that account already sends/receives as `admin@electioncanon.org` per existing project convention — see `src/domains/outreach/model.js`'s `SENDER_ACCOUNT` vocabulary). The integration requests exactly two scopes: `gmail.send` (dispatch) and `gmail.readonly` (reply detection/reconciliation) — never `gmail.modify`, so it can never delete, label, or archive anything in that mailbox.

## Steps

1. **Create (or choose) a Google Cloud project.** console.cloud.google.com → New Project (or reuse an existing one you control).
2. **Enable the Gmail API.** APIs & Services → Library → search "Gmail API" → Enable.
3. **Configure the OAuth consent screen.** APIs & Services → OAuth consent screen.
   - User type: External (unless you have a Google Workspace organization to restrict to Internal).
   - Scopes: add `https://www.googleapis.com/auth/gmail.send` and `https://www.googleapis.com/auth/gmail.readonly`.
   - Test users: add the exact Gmail address you're connecting (e.g. `sotinnovate@gmail.com`) while the app is in "Testing" status — a refresh token for an account not listed here will not be issued.
4. **Create an OAuth client ID.** APIs & Services → Credentials → Create Credentials → OAuth client ID → Application type: **Web application**.
   - Authorized redirect URI: `https://lncwkjlgakonokwboxdp.supabase.co/functions/v1/outreach-gmail/oauth_callback` (this project's live Edge Function URL + `/oauth_callback`, matching exactly what `outreach-gmail/index.ts` checks `req.url`'s path against).
   - Save the **Client ID** and **Client Secret** it gives you.
5. **Generate a token-encryption key.** Any 32 random bytes, base64-encoded. From a terminal: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` (or any equivalent — PowerShell, `openssl rand -base64 32`, etc.). This is NOT a Google value; it's used only by this project to encrypt the Gmail refresh token at rest (AES-256-GCM, see `outreach-gmail/index.ts`'s own header).
6. **Set four Edge Function secrets** on the `lncwkjlgakonokwboxdp` Supabase project (via `supabase secrets set ... --project-ref lncwkjlgakonokwboxdp`, or Project Settings → Edge Functions → Secrets in the dashboard):
   - `GOOGLE_CLIENT_ID` — from step 4.
   - `GOOGLE_CLIENT_SECRET` — from step 4.
   - `GOOGLE_REDIRECT_URI` — the exact URI from step 4 (`https://lncwkjlgakonokwboxdp.supabase.co/functions/v1/outreach-gmail/oauth_callback`).
   - `GMAIL_TOKEN_ENCRYPTION_KEY` — from step 5.
7. **Deploy `outreach-gmail`** (not yet deployed as of this writing — requires the same explicit deployment approval every other Edge Function deploy in this project requires): `supabase functions deploy outreach-gmail --project-ref lncwkjlgakonokwboxdp --no-verify-jwt` (no-verify-jwt because this function authenticates via its own `OUTREACH_ADMIN_SECRET` bearer header for every action except the one unauthenticated OAuth redirect, exactly like `launch-send-campaign-email`).
8. **Apply the schema migration** (also not yet applied — same approval requirement): `supabase/migrations/20261014000000_election_outreach_message_activity.sql` adds `outreach_message_events` and `outreach_gmail_connection`.
9. **Run the connect flow** from the control room (once wired — see below) or directly:
   - `POST outreach-gmail` with `{"action":"get_auth_url"}` (bearer: `OUTREACH_ADMIN_SECRET`) → returns a Google consent URL.
   - Open that URL in a browser signed into the Gmail account you listed as a test user in step 3, approve, and you'll land back on `/oauth_callback`, which stores the encrypted refresh token.
10. **Verify the send-as identity.** `POST outreach-gmail` with `{"action":"verify_send_as","identity":"admin@electioncanon.org"}`. This checks Gmail's own `users.settings.sendAs` list for that account — if `admin@electioncanon.org` is not already configured as a verified "Send mail as" alias inside the connected Gmail account's own settings (Gmail → Settings → Accounts → "Send mail as"), this will report `verified: false`, and `send_message` will refuse to dispatch under that identity until it's fixed **inside Gmail's own settings first**, not just in this project.

## What exists today without any of this

Everything that doesn't require a live Gmail connection: the full request-validation/MIME-building/response-interpretation logic (`outreach-gmail/contract.mjs`, independently unit-tested — see `test/election-outreach-gmail-function.consumer.mjs`, 47/47 passing with zero network access), the evidence-layer schema and domain logic (`outreach_message_events`, `src/domains/outreach/messageActivity.js`), and the branded HTML composer (`src/domains/outreach/composer.js`). None of this required Google credentials to build or test, and all of it continues to work for manual-send reconciliation (recording a human's attested send with real evidence fields) regardless of whether Gmail OAuth is ever configured.

## Manual outreach is never blocked by any of this

Nothing above changes how the existing `admin@electioncanon.org`/`sotinnovate@gmail.com` Gmail drafts and sends already work. A human can keep sending letters by hand indefinitely; `record_message_event` (via `outreach-admin`, already deployed) accepts a `MANUAL_ATTESTATION` event with a real `occurredAt` for exactly this case, independent of whether the Gmail API integration above is ever turned on.

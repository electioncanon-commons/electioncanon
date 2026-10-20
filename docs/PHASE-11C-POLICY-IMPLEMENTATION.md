# Phase 11C — Approved Send-Recovery Policy Implementation

Date: 2026-10-14. Scope: implement two policy decisions that
`docs/PHASE-11B-SEND-RECOVERY-DESIGN.md` left explicitly **unresolved** (§7
and §8) and that this phase's brief now authorizes closing. No RPC/schema
redesign, no OAuth setup, no reply-sync work, no UI work -- same narrow-scope
discipline as 11B. Local source/test changes only; nothing committed,
staged, pushed, migrated, or deployed. See
`docs/PHASE-11C-VERIFICATION-REPORT.md` for test results, build result,
migration preflight, and the live-verification plan.

## 1. The two approved policies, as authorized

**Policy A (NOT_SENT).** A send attempt may be classified `NOT_SENT` only
when: the attempt is durably recorded; its timestamp is preserved; and
definitive provider evidence establishes the provider did not accept the
message. Timeouts, connection failures with uncertain outcomes, missing
responses, and other ambiguous outcomes must remain `UNKNOWN`. An uncertain
outcome must never be allowed to authorize a potentially duplicate send.

**Policy B (FAILED → SENT).** Reconciliation from `FAILED` to `SENT` is
permitted only when provider evidence establishes the message was actually
sent. The real provider message id is preserved, and the missing evidence
record is repaired or inserted. Provider identifiers/evidence are never
fabricated.

## 2. What was actually true before this phase, for each policy

**Policy A had a real, exploitable gap.** `validateReconcileSendClaimRequest`
required **nothing** for an `outcome: "NOT_SENT"` reconciliation -- no note,
no evidence of any kind (design doc §7, explicitly flagged and left
unresolved). Nothing stopped an operator from reconciling a genuinely
`UNKNOWN` claim (Gmail call timed out; the real outcome was never learned)
to `NOT_SENT` on a bare assertion. That matters concretely: `NOT_SENT`
resolves the claim to `FAILED`, and a `FAILED` claim is exactly what
licenses `send_message`'s `PREVIOUSLY_FAILED` response text ("use a new
confirmationId to try again") -- i.e. a route back to a real second Gmail
call under a new key. If the original, truly-ambiguous send had in fact
succeeded, an unevidenced `NOT_SENT` reconciliation followed by a retry
would produce a genuine duplicate email. This was the literal risk Policy A
was written to close, and the pre-11C code did not close it.

The **automated** classification path (inside `send_message` itself) was
already compliant and needed no change: `interpretGmailSendResponse`
already distinguishes a real HTTP response saying "no" (→ `FAILED`, a
definite provider answer) from a thrown network exception / timeout (→
`UNKNOWN`, ambiguous) -- see `contract.mjs` D-section tests and `index.ts`'s
`send_message` try/catch. Policy A's gap was entirely in the **manual**
reconciliation path.

**Policy B had no gap -- it was already the exact, literal behavior,
just undecided-as-policy.** `decideReconciliation`'s `RESOLVE_SENT`/
`REPAIR_MISSING_EVIDENCE` branches were already reachable from a `FAILED`
claim (or any non-`SENT` claim), strictly gated on
`validateReconcileSendClaimRequest` requiring a real, non-empty
`providerMessageId` -- never fabricated, never a bare assertion. Design doc
§8 presented three framings and recommended (not implemented) a distinct
`force`-flagged override action. **That recommendation is not adopted.**
Phase 11C's brief approves Policy B exactly as literally stated --
"permitted ... when provider evidence establishes the message was actually
sent ... preserve the real provider message id ... do not fabricate" --
with no requirement for a separate override flag. The existing code already
satisfies this. No code change was made for Policy B; its status changes
from "preserved, unresolved" to "preserved, **explicitly ratified**."

## 3. Code changes (Policy A only)

**`supabase/functions/outreach-gmail/contract.mjs`**
- New constants `MIN_NOT_SENT_PROVIDER_EVIDENCE_LENGTH` (15) and
  `MAX_NOT_SENT_PROVIDER_EVIDENCE_LENGTH` (500).
- `validateReconcileSendClaimRequest`: an `outcome: "NOT_SENT"` request is
  now refused unless `providerEvidence` is a real string, trimmed length
  between the two bounds. The returned, validated shape carries
  `providerEvidence` through (trimmed; `null` for a `SENT` reconciliation,
  where it is meaningless).
- The minimum bound exists so an empty or trivial string (`"x"`, `" "`)
  can never satisfy the requirement -- it cannot, by itself, prove the
  operator found real evidence (that limitation is inherent to any
  server-side text field and is not claimed to be solved; see §5). The
  maximum bound exists so `providerEvidence`, combined with the pre-existing
  optional `note` field, always fits inside
  `outreach_message_send_claims.error`'s `char_length(error) <= 2000`
  constraint with comfortable headroom -- see §4.

**`supabase/functions/outreach-gmail/index.ts`**
- `reconcile_send_claim`'s header comment documents both ratified policies.
- The `RESOLVE_NOT_SENT` branch's `updateClaimConditional` call now stores
  `providerEvidence` directly in the claim's own `error` column (previously
  it stored only the optional `note`, or the fixed string "manually
  reconciled as not sent" if no note was given). This is what makes Policy
  A's "durably recorded" and "definitive evidence" requirements real and
  auditable on the row itself, not just enforced transiently at the HTTP
  boundary.
- No other action, and no other part of `send_message`, was touched.

**Not changed:** `decideReconciliation`'s decision tree itself is
unchanged -- `RESOLVE_NOT_SENT` is still reached the same way (no evidence
row, claim not already `SENT`). The new requirement is enforced entirely at
request validation, one layer up, consistent with how `validateSendMessageRequest`
and the `SENT`-outcome `providerMessageId` requirement already work in this
file. `classifyExistingClaim`, `insertEvidenceIdempotent`,
`updateClaimConditional`, and every `send_message` code path are untouched.

## 4. Migration/schema compatibility review (no migration created)

Reviewed `supabase/migrations/20261014000000_election_outreach_message_activity.sql`
against this phase's change:
- `outreach_message_send_claims.error` is `text check (error is null or
  char_length(error) <= 2000)` -- already exists, already unexposed to any
  client role (zero RLS policies for any role; table is read/written only
  by the `outreach-gmail` Edge Function under the service role). No column,
  constraint, index, or grant change is required.
- Worst-case length check: the new `RESOLVE_NOT_SENT` error string is
  `"manually reconciled as not sent -- provider evidence: "` (54 chars) +
  `providerEvidence` (≤500) + optional `" (note: " + note + ")"`. `note`
  itself has **no length bound** in `contract.mjs` today -- a pre-existing
  gap from Phase 11B, not introduced by this phase. In the pathological
  case of an operator supplying an enormous `note`, the combined string
  could exceed 2000 chars and the real Postgres check constraint would
  reject the `UPDATE` with a genuine error. `updateClaimConditional`
  already handles this safely: a genuine (non-exception) Postgres error is
  reported `ok:false, ambiguous:false` with the real error text (never
  silently swallowed, never treated as success) -- but `index.ts`'s
  `!claimUpdate.ok` branch currently *frames* any such failure as "a
  concurrent reconciliation already resolved this claim," which would be a
  misleading message for a constraint violation specifically. This is a
  **pre-existing, narrow error-message-framing gap**, orthogonal to
  Policies A/B, not touched by this phase's authorized scope, and is
  flagged here rather than silently left undocumented. Recommendation (not
  implemented, left for explicit authorization): bound `note`'s length in
  `validateReconcileSendClaimRequest` the same way `providerEvidence` now
  is.
- No new table, view, index, grant, or RLS policy is needed for either
  policy. The existing `outreach_send_claim_inconsistencies` diagnostic
  view (Phase 11B) is unaffected and still correctly surfaces the two
  inconsistency shapes it was built for; neither policy changes what
  "inconsistent" means for that view.
- The migration file itself was not edited in this phase (confirmed: `git
  status` shows it still untracked from Phase 11B, unchanged content).

## 5. Explicit, disclosed limitation of Policy A's implementation

`providerEvidence` is a free-text field, bounded only by length. This
phase's validation **cannot** cryptographically or structurally verify that
the text actually describes real, checked, definitive provider evidence
(e.g. an actual Gmail API error code the operator saw, vs. invented
prose of the right shape). This is the same limitation the Phase 11B design
doc already disclosed about a mandatory `note` (§7: "it would also be easy
to satisfy with a meaningless string"). What this phase's change *does*
guarantee, and did not before: the field cannot be omitted, cannot be
empty/whitespace, cannot be a one-character stub, and whatever is supplied
is durably persisted on the claim row for later audit -- not that the
operator necessarily told the truth. Closing that remaining gap further
(e.g. requiring a specific evidence shape, like a Gmail error code
enum, or cross-checking against Gmail's real API from a live reconciliation
flow) is out of this phase's authorized scope and not implemented.

// ============================================================
// LAUNCH DISTRIBUTION — CONFIRM CONTRACT  (Alpha 1.7, Brevo pass)
//
// Same plain-JavaScript/no-Deno-APIs split as every contract.mjs in
// this repo. This wraps confirm_launch_subscription() (SECURITY
// DEFINER, 20260921000000_election_launch_distribution.sql) with a
// Brevo contact sync -- see index.ts's own header for why the sync
// can't live in Postgres (it needs BREVO_API_KEY, a secret) or in the
// browser (same reason) and therefore needs this Edge Function at all,
// where the client previously called the RPC directly.
//
// THE RPC ITSELF IS UNCHANGED. This file adds NO new authorization
// logic -- validateConfirmRequest() only checks that a token string was
// supplied; the actual token-secrecy/idempotency guarantees are still
// entirely confirm_launch_subscription()'s own, exactly as before this
// pass. "Preserve the existing confirmation flow" literally.
// ============================================================

export function validateConfirmRequest(body) {
  const token = body && typeof body === "object" ? body.token : undefined;
  if (typeof token !== "string" || !token.trim()) {
    return { valid: false, reason: "a confirmation token is required" };
  }
  return { valid: true, token: token.trim() };
}

/**
 * Brevo's contact upsert shape (POST /v3/contacts, updateEnabled:true so
 * a re-confirm never fails with a "contact already exists" error).
 * listId is optional -- omitted entirely (never sent as null/empty)
 * when BREVO_LIST_ID isn't configured yet, so contact creation never
 * blocks on a list that doesn't exist (see this pass's own plan on why
 * list creation is a manual, not a blind-coded, step).
 */
export function buildBrevoContactUpsert({ email, sourceCampaign, referralId, listId }) {
  const payload = {
    email,
    attributes: {
      SOURCE_CAMPAIGN: sourceCampaign ?? null,
      REFERRAL_ID: referralId ?? null,
    },
    updateEnabled: true,
  };
  if (listId) payload.listIds = [listId];
  return payload;
}

/** Brevo contact endpoints return 201 (created) or 204 (updated, no body) on success; a 4xx carries {code,message}. */
export function interpretBrevoContactResponse(status, body) {
  if (status >= 200 && status < 300) return { ok: true, error: null };
  const message = (body && body.message) || `contact provider returned HTTP ${status}`;
  return { ok: false, error: message };
}

export default { validateConfirmRequest, buildBrevoContactUpsert, interpretBrevoContactResponse };

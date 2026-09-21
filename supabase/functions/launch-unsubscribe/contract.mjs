// ============================================================
// LAUNCH DISTRIBUTION — UNSUBSCRIBE CONTRACT  (Alpha 1.7, Brevo pass)
//
// Same shape as launch-confirm/contract.mjs, wrapping
// unsubscribe_launch_subscription() (SECURITY DEFINER, 20260921000000_
// election_launch_distribution.sql) with a Brevo contact update so
// Brevo's own suppression list also reflects the opt-out -- see
// index.ts's own header for why this can't live in Postgres or the
// browser.
// ============================================================

export function validateUnsubscribeRequest(body) {
  const token = body && typeof body === "object" ? body.token : undefined;
  if (typeof token !== "string" || !token.trim()) {
    return { valid: false, reason: "an unsubscribe token is required" };
  }
  return { valid: true, token: token.trim() };
}

/** Brevo's contact update shape (PUT /v3/contacts/{email}) -- blacklists the address from further Brevo sends (both transactional-list and campaign). */
export function buildBrevoContactUnsubscribe() {
  return { emailBlacklisted: true };
}

/** Brevo's contact update returns 204 (no body) on success; a 4xx carries {code,message}. A 404 (contact never existed in Brevo -- e.g. they unsubscribed before ever confirming) is NOT an error here; there is nothing to blacklist. */
export function interpretBrevoContactResponse(status, body) {
  if (status === 404 || (status >= 200 && status < 300)) return { ok: true, error: null };
  const message = (body && body.message) || `contact provider returned HTTP ${status}`;
  return { ok: false, error: message };
}

export default { validateUnsubscribeRequest, buildBrevoContactUnsubscribe, interpretBrevoContactResponse };

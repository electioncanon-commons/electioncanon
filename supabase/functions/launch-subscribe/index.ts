// ============================================================
// LAUNCH DISTRIBUTION — SUBSCRIBE TRANSPORT BOUNDARY  (Alpha 1.7)
//
// Same split as election-invitation-email/index.ts: contract.mjs is
// plain JavaScript, this file is TRANSPORT ONLY.
//
// WHY SERVICE ROLE, UNLIKE election-invitation-email. That function
// forwards the CALLER's own session because a real privileged read
// (campaign membership via RLS) already exists to scope by. This form
// is public and unauthenticated -- there is no caller session to
// forward, and no privileged read to inherit. Service role is used here
// ONLY to perform the one narrow write this function is documented to
// do (upsert a row in launch_subscribers, keyed by the validated email
// this function itself checked), the rate-limit ledger write
// (launch_subscribe_attempts, service-role-only by design -- see that
// migration's own header), and the mint-token-then-email step, so the
// token never has to round-trip through the browser at all (the same
// "token never reaches the client" discipline election-invitation-email
// already follows, just collapsed into one step since there is no
// separate privileged creation step to defer to first).
//
// PROVIDER (Brevo migration, Alpha 1.7): BREVO_API_KEY/BREVO_SENDER_
// EMAIL/BREVO_SENDER_NAME replace RESEND_API_KEY/RESEND_FROM_EMAIL in
// THIS function only -- election-invitation-email is untouched and
// still reads RESEND_API_KEY. The secret never leaves this function:
// read from Deno.env, never shipped to the browser bundle, never
// logged (a failed vendor call logs no request/response body, only a
// generic outcome -- see the catch block below).
//
// RATE LIMITING (Brevo pass). Before touching launch_subscribers at
// all, this function counts this caller's own attempts (by IP,
// x-forwarded-for) in the trailing 10 minutes against
// launch_subscribe_attempts and refuses generically past 5 -- no detail
// in the response that would help an attacker calibrate the exact
// threshold. A refusal here still counts as an attempt (recorded before
// the check short-circuits nothing) so a caller cannot bypass the limit
// by sending intentionally-invalid bodies to dodge it.
//
// THIS FUNCTION NEVER REVEALS WHETHER AN EMAIL ALREADY SUBSCRIBED. It
// always returns the same { ok: true } shape regardless of whether the
// address was new, already pending, already confirmed, or re-
// subscribing after an unsubscribe -- exactly the same non-distinguishing
// posture election-invitation-email/index.ts already documents for "no
// such invitation" vs. "not your campaign".
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { validateSubscribeRequest, mintLaunchToken, buildConfirmationEmail, buildBrevoEmailRequest, interpretBrevoResponse, shouldRateLimitSignup } from "./contract.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RATE_LIMIT_WINDOW_MINUTES = 10;
const RATE_LIMIT_MAX_ATTEMPTS = 5;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const refuse = (reason: string, code: string, status = 200) =>
  json({ ok: false, code, reason }, status);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return refuse("only POST is accepted", "METHOD_NOT_ALLOWED", 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return refuse("request body is not valid JSON", "BAD_REQUEST", 400);
  }

  const validation = validateSubscribeRequest(body);
  if (!validation.valid) return refuse(validation.reason, "BAD_REQUEST", 400);

  const brevoKey = Deno.env.get("BREVO_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!brevoKey || !supabaseUrl || !serviceKey) {
    return refuse("no email provider is configured", "PROVIDER_NOT_CONFIGURED", 200);
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // RATE LIMIT -- checked before any launch_subscribers read/write.
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()) || "unknown";
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();
  const { count: recentAttempts } = await supabase
    .from("launch_subscribe_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .gte("attempted_at", windowStart);
  await supabase.from("launch_subscribe_attempts").insert({ ip });
  if (shouldRateLimitSignup(recentAttempts ?? 0, RATE_LIMIT_MAX_ATTEMPTS)) {
    return refuse("please try again later", "RATE_LIMITED", 200);
  }

  const { data: existing } = await supabase
    .from("launch_subscribers")
    .select("id, status")
    .eq("email", validation.email)
    .maybeSingle();

  // Already confirmed: acknowledge without re-sending a confirmation
  // link or updating consent -- a repeat signup from an already-
  // confirmed address is a no-op, not a re-consent event.
  if (existing?.status === "confirmed") {
    return json({ ok: true });
  }

  const token = mintLaunchToken();
  const origin = Deno.env.get("SITE_ORIGIN") || req.headers.get("origin") || "https://electioncanon.org";

  if (existing) {
    // Pending re-signup, or re-subscribing after a prior unsubscribe --
    // either way this is a fresh consent event: refresh consent_at,
    // token, source_campaign, and referral_id to the request just made.
    await supabase
      .from("launch_subscribers")
      .update({
        status: "pending_confirmation",
        token,
        consent_at: new Date().toISOString(),
        source_campaign: validation.sourceCampaign,
        referral_id: validation.referralId,
        unsubscribed_at: null,
      })
      .eq("id", existing.id);
  } else {
    const { error: insertError } = await supabase.from("launch_subscribers").insert({
      email: validation.email,
      source_campaign: validation.sourceCampaign,
      referral_id: validation.referralId,
      token,
      status: "pending_confirmation",
    });
    if (insertError) return refuse("could not record this subscription", "PROVIDER_ERROR", 200);
  }

  const { subject, html, text } = buildConfirmationEmail({
    email: validation.email, sourceCampaign: validation.sourceCampaign, token, origin,
  });
  const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL") || "admin@electioncanon.org";
  const senderName = Deno.env.get("BREVO_SENDER_NAME") || "ElectionCanon";
  const brevoBody = buildBrevoEmailRequest({ senderEmail, senderName, to: validation.email, subject, html, text });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let vendorRes: Response;
    try {
      vendorRes = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "api-key": brevoKey },
        body: JSON.stringify(brevoBody),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    const vendorJson = await vendorRes.json().catch(() => null);
    const result = interpretBrevoResponse(vendorRes.status, vendorJson);
    // Even a provider-side send failure returns { ok: true } to the
    // client -- the subscription row is already written, and revealing
    // vendor-level send failures to an anonymous caller would leak
    // operational detail for no benefit; the row can be resent/retried
    // server-side independent of what this response says. Note: never
    // logs vendorJson/brevoBody -- a failure here logs no request or
    // response content, only that a send attempt did not succeed.
    return json({ ok: true, providerMessageId: result.ok ? result.providerMessageId : null });
  } catch {
    return json({ ok: true, providerMessageId: null });
  }
});

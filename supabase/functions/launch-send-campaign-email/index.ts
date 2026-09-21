// ============================================================
// LAUNCH DISTRIBUTION — SEQUENCE SEND TRANSPORT BOUNDARY  (Alpha 1.7)
//
// OWNER-TRIGGERED ONLY. This function is never called by the public
// site, never scheduled, and no cron/pg_cron job in this repository
// invokes it. It requires a LAUNCH_ADMIN_SECRET bearer token that only
// the project owner holds (a new Edge Function secret they generate
// themselves) -- a deliberate choice: automatically emailing real
// confirmed subscribers on a schedule with zero human trigger is a real
// production action with external effect, and this repository's own
// PREPARE/APPROVE/EXECUTE discipline (see docs/ARCHITECTURE.md) treats
// "no silent automatic writes" as a first-class rule, applied here to
// "no silent automatic sends." The three templates are prepared in
// contract.mjs; an actual send is always a deliberate, explicit,
// owner-run action (see docs/RELEASE.md for the exact command).
//
// SERVICE ROLE, SAME REASONING AS launch-subscribe/index.ts: there is no
// caller session to forward (the caller here is the project owner via a
// shared secret, not a Supabase Auth session), and launch_subscribers
// carries no client SELECT/UPDATE policy at all -- reading and marking
// sequence_N_sent_at requires the service role by design.
//
// CONFIRMED + NOT UNSUBSCRIBED + NOT YET SENT THIS STEP, ONLY. A
// subscriber who never confirmed is never emailed (no confirmed
// consent, no send -- this is the literal enforcement of the launch
// brief's consent requirement, not just a comment). Each subscriber's
// own token builds their own real unsubscribe link -- see contract.mjs.
// (.eq("status", "confirmed") below is ALSO the "not unsubscribed"
// filter -- status is a closed three-way enum and "unsubscribed" is a
// distinct value from "confirmed", so this one filter satisfies both.)
//
// PROVIDER (Brevo migration, Alpha 1.7): BREVO_API_KEY/BREVO_SENDER_
// EMAIL/BREVO_SENDER_NAME replace RESEND_API_KEY/RESEND_FROM_EMAIL in
// THIS function only -- election-invitation-email is untouched.
//
// SEQUENCE_CONTENT_READY (see contract.mjs) is checked inside
// validateSendCampaignRequest() itself, so an attempt to send sequence 2
// or 3 is refused with CONTENT_NOT_READY before this function even
// reads BREVO_API_KEY or queries a single subscriber -- a valid
// LAUNCH_ADMIN_SECRET alone is never sufficient to send nonexistent
// AD02/AD03 content.
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { validateSendCampaignRequest, buildSequenceEmail, buildBrevoEmailRequest, interpretBrevoResponse } from "./contract.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const refuse = (reason: string, code: string, status = 200) =>
  json({ ok: false, code, reason }, status);

const SENT_COLUMN: Record<number, string> = { 1: "sequence_1_sent_at", 2: "sequence_2_sent_at", 3: "sequence_3_sent_at" };

// At most this many subscribers per invocation -- keeps one call well
// inside the Edge Function's own execution time budget; running it
// again (same LAUNCH_ADMIN_SECRET, same step) picks up wherever it left
// off, since already-sent rows are excluded by the sequence_N_sent_at
// filter itself.
const BATCH_LIMIT = 200;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return refuse("only POST is accepted", "METHOD_NOT_ALLOWED", 405);

  const adminSecret = Deno.env.get("LAUNCH_ADMIN_SECRET");
  const authHeader = req.headers.get("Authorization");
  if (!adminSecret || authHeader !== `Bearer ${adminSecret}`) {
    return refuse("this action requires the launch admin secret", "UNAUTHENTICATED", 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return refuse("request body is not valid JSON", "BAD_REQUEST", 400);
  }

  const validation = validateSendCampaignRequest(body);
  if (!validation.valid) return refuse(validation.reason, validation.code ?? "BAD_REQUEST", 400);

  const brevoKey = Deno.env.get("BREVO_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!brevoKey || !supabaseUrl || !serviceKey) {
    return refuse("no email provider is configured", "PROVIDER_NOT_CONFIGURED", 200);
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const sentColumn = SENT_COLUMN[validation.sequence];
  const origin = Deno.env.get("SITE_ORIGIN") || "https://electioncanon.org";
  const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL") || "admin@electioncanon.org";
  const senderName = Deno.env.get("BREVO_SENDER_NAME") || "ElectionCanon";

  const { data: recipients, error: readError } = await supabase
    .from("launch_subscribers")
    .select("id, email, token")
    .eq("status", "confirmed")
    .is(sentColumn, null)
    .order("created_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (readError) return refuse("could not read confirmed subscribers", "PROVIDER_ERROR", 200);

  let sent = 0;
  let failed = 0;
  for (const recipient of recipients ?? []) {
    const { subject, html, text } = buildSequenceEmail({ step: validation.sequence, token: recipient.token, origin });
    const brevoBody = buildBrevoEmailRequest({ senderEmail, senderName, to: recipient.email, subject, html, text });
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
      if (!result.ok) { failed++; continue; }
      await supabase.from("launch_subscribers").update({ [sentColumn]: new Date().toISOString() }).eq("id", recipient.id);
      sent++;
    } catch {
      failed++;
    }
  }

  return json({ ok: true, sequence: validation.sequence, attempted: (recipients ?? []).length, sent, failed });
});

// ============================================================
// LAUNCH DISTRIBUTION — CONFIRM TRANSPORT BOUNDARY  (Alpha 1.7, Brevo pass)
//
// NEW THIS PASS. Before Brevo, the client (LaunchConfirm.jsx via
// src/domains/launch/write.js) called confirm_launch_subscription()
// directly via client.rpc() -- that RPC is PUBLIC, granted to anon, and
// needed no server-side secret. Brevo contact sync does need a secret
// (BREVO_API_KEY), which cannot live in the browser, so this thin
// wrapper now sits between the client and that same RPC.
//
// THE RPC CALL ITSELF IS UNCHANGED -- same function, same SQL, same
// security model, just invoked from here instead of directly. This
// function adds NO new privilege to what confirming already grants; it
// adds a best-effort side effect (Brevo sync) on top of an unchanged
// write.
//
// WHY SERVICE ROLE. Two reasons, unlike a plain RPC forward: (1) after
// a genuinely NEW confirmation, this function needs to read the
// subscriber's own email/source_campaign/referral_id to build the Brevo
// contact payload -- launch_subscribers carries no client SELECT policy
// at all (see that migration's own header), so only service role can
// read it back; (2) there is no caller session to forward anyway (same
// public/unauthenticated posture as launch-subscribe).
//
// A BREVO FAILURE NEVER UNDOES OR BLOCKS THE CONFIRMATION. The RPC's
// write already succeeded by the time Brevo is even called -- exactly
// like createInvitation() (src/domains/election/invitations/write.js)
// reports emailStatus separately from the invitation row's own success.
// brevoSynced:false here means "confirmed, but Brevo doesn't know yet",
// never "not confirmed."
//
// ALREADY-CONFIRMED REPLAYS NEVER RE-SYNC. Brevo sync only runs when the
// RPC reports a genuinely new confirmation (already_confirmed === false)
// -- a repeat visit to the same confirm link is a pure no-op past the
// RPC's own idempotency, exactly as it was before this pass.
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { validateConfirmRequest, buildBrevoContactUpsert, interpretBrevoContactResponse } from "./contract.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

  const validation = validateConfirmRequest(body);
  if (!validation.valid) return refuse(validation.reason, "BAD_REQUEST", 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return refuse("server misconfiguration", "PROVIDER_NOT_CONFIGURED", 200);

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const { data: rpcData, error: rpcError } = await supabase.rpc("confirm_launch_subscription", { p_token: validation.token });
  const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  if (rpcError || !row?.ok) {
    return refuse("this confirmation link is invalid or has expired", "NOT_FOUND", 200);
  }
  if (row.already_confirmed) {
    return json({ ok: true, alreadyConfirmed: true, brevoSynced: false });
  }

  // Genuinely new confirmation -- best-effort Brevo sync. Never reads
  // any column beyond what the payload needs, never returns subscriber
  // PII (email/source_campaign/referral_id) in the response below.
  let brevoSynced = false;
  const brevoKey = Deno.env.get("BREVO_API_KEY");
  if (brevoKey) {
    const { data: subscriber } = await supabase
      .from("launch_subscribers")
      .select("email, source_campaign, referral_id")
      .eq("token", validation.token)
      .maybeSingle();
    if (subscriber) {
      const listIdRaw = Deno.env.get("BREVO_LIST_ID");
      const listId = listIdRaw ? Number.parseInt(listIdRaw, 10) : null;
      const payload = buildBrevoContactUpsert({
        email: subscriber.email, sourceCampaign: subscriber.source_campaign,
        referralId: subscriber.referral_id, listId: Number.isFinite(listId) ? listId : null,
      });
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        let vendorRes: Response;
        try {
          vendorRes = await fetch("https://api.brevo.com/v3/contacts", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json", "api-key": brevoKey },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
        const vendorJson = await vendorRes.json().catch(() => null);
        brevoSynced = interpretBrevoContactResponse(vendorRes.status, vendorJson).ok;
      } catch {
        brevoSynced = false;
      }
    }
  }

  return json({ ok: true, alreadyConfirmed: false, brevoSynced });
});

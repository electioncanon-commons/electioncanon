// ============================================================
// LAUNCH DISTRIBUTION — UNSUBSCRIBE TRANSPORT BOUNDARY  (Alpha 1.7, Brevo pass)
//
// NEW THIS PASS -- same reasoning as launch-confirm/index.ts: the client
// used to call unsubscribe_launch_subscription() directly via
// client.rpc(); this thin wrapper now sits in between so a genuinely new
// unsubscribe can also blacklist the address in Brevo (a secret-gated
// action that cannot live in Postgres or the browser). The RPC itself,
// its SQL, and its security model are completely unchanged.
//
// UNSUBSCRIBED USERS MUST NOT RECEIVE FUTURE LAUNCH EMAILS -- enforced
// TWICE, independently: (1) launch-send-campaign-email's own query
// already filters .eq("status","confirmed"), which excludes
// "unsubscribed" by construction (see that function's own header); (2)
// this function additionally blacklists the address in Brevo itself, so
// even Brevo's own dashboard-triggered sends (outside this codebase's
// own sequence sender) would refuse to deliver to them.
//
// SERVICE ROLE for the same two reasons as launch-confirm: no caller
// session to forward, and a post-unsubscribe email read is needed to
// build the Brevo payload (launch_subscribers has no client SELECT
// policy).
//
// A BREVO FAILURE NEVER UNDOES THE UNSUBSCRIBE. The RPC's write (the
// fact that actually matters -- no more sequence emails, see above) has
// already succeeded; brevoSynced:false means only that Brevo's own
// suppression list hasn't caught up yet, never that the person is still
// subscribed.
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { validateUnsubscribeRequest, buildBrevoContactUnsubscribe, interpretBrevoContactResponse } from "./contract.mjs";

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

  const validation = validateUnsubscribeRequest(body);
  if (!validation.valid) return refuse(validation.reason, "BAD_REQUEST", 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return refuse("server misconfiguration", "PROVIDER_NOT_CONFIGURED", 200);

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const { data: subscriberBefore } = await supabase
    .from("launch_subscribers")
    .select("email")
    .eq("token", validation.token)
    .maybeSingle();

  const { data: rpcData, error: rpcError } = await supabase.rpc("unsubscribe_launch_subscription", { p_token: validation.token });
  const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  if (rpcError || !row?.ok) {
    return refuse("this unsubscribe link is invalid", "NOT_FOUND", 200);
  }

  let brevoSynced = false;
  const brevoKey = Deno.env.get("BREVO_API_KEY");
  if (brevoKey && subscriberBefore?.email) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      let vendorRes: Response;
      try {
        vendorRes = await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(subscriberBefore.email)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Accept: "application/json", "api-key": brevoKey },
          body: JSON.stringify(buildBrevoContactUnsubscribe()),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      const vendorJson = vendorRes.status === 204 ? null : await vendorRes.json().catch(() => null);
      brevoSynced = interpretBrevoContactResponse(vendorRes.status, vendorJson).ok;
    } catch {
      brevoSynced = false;
    }
  }

  return json({ ok: true, brevoSynced });
});

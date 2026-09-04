// ============================================================
// ELECTIONCANON INVITATION EMAIL — SERVER-SIDE TRANSPORT BOUNDARY
// (First-user completion pass, item 4)
//
// Same split as election-voice/index.ts: contract.mjs is plain JavaScript
// with no Deno APIs (Node's own test suite runs it directly), this file is
// TRANSPORT ONLY.
//
// UNLIKE election-voice, this function DOES hold a Supabase client — but
// only ever with the CALLER's own forwarded Authorization header, never
// the service role. It is instantiated fresh per-request from that header
// (not held as a module-level singleton) precisely so it can never be
// reused across two different callers' privileges. That means every read
// it performs is still gated by the real RLS policy "invitations read own
// campaign" (is_active_campaign_member) exactly as if the browser had
// queried Postgres directly — this function adds a mail-sending capability
// on top of an existing, already-correct read boundary, it does not widen
// it. See contract.mjs's own header for why the request body carries only
// invitation_id, never email content.
//
// PROVIDER SECRET NEVER LEAVES HERE. RESEND_API_KEY is read from
// Deno.env — a Supabase Edge Function secret, never shipped to Vite/the
// browser bundle. The public site origin (for building the /invite/:token
// link) is also environment-configured, not client-supplied, so a caller
// cannot redirect the email's own link to an attacker-controlled domain.
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { validateSendRequest, buildInvitationEmail, buildResendRequest, interpretResendResponse } from "./contract.mjs";

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

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return refuse("this request requires a signed-in session", "UNAUTHENTICATED", 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return refuse("request body is not valid JSON", "BAD_REQUEST", 400);
  }

  const validation = validateSendRequest(body);
  if (!validation.valid) return refuse(validation.reason, "BAD_REQUEST", 400);

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return refuse("no email provider is configured", "PROVIDER_NOT_CONFIGURED", 200);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) return refuse("server misconfiguration", "PROVIDER_NOT_CONFIGURED", 200);

  // The CALLER's own session, forwarded verbatim -- never the service
  // role. Every read below runs exactly as if the browser had run it.
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: invitation, error: readError } = await supabase
    .from("campaign_invitations")
    .select("id, campaign_id, token, invited_name, invited_email, intended_responsibility_role, intended_level, status, expires_at")
    .eq("id", validation.invitationId)
    .maybeSingle();

  if (readError || !invitation) {
    // Deliberately does not distinguish "no such invitation" from "you are
    // not a member of that campaign" -- either way the caller has no
    // standing to trigger this send, and the two cases are indistinguishable
    // from outside RLS by design.
    return refuse("this invitation could not be found for your account", "NOT_FOUND", 200);
  }
  if (invitation.status !== "pending") {
    return refuse(`this invitation is ${invitation.status} and cannot be (re)sent`, "NOT_PENDING", 200);
  }

  const { data: preview } = await supabase
    .rpc("get_invitation_preview", { p_token: invitation.token })
    .maybeSingle();

  // WHO INVITED THEM. The caller of THIS function is the inviter, by
  // construction of create_campaign_invitation() (invited_by = auth.uid()
  // at creation time). ELECTIONCANON 1.1.1 PHASE A UX PASS -- this used to
  // query public.profiles for the caller's own display_name, exactly
  // mirroring get_invitation_preview()'s own original mistake: that table
  // does not exist in the ElectionCanon Supabase project (confirmed this
  // session), so the query always silently failed and this ALWAYS fell
  // through to `caller.email` -- the inviter's raw email was being shown
  // as their own name in every invitation email sent. get_invitation_
  // preview() was already corrected to read auth.users.raw_user_meta_data
  // ->> 'display_name' instead (20260904010000_election_invitation_
  // preview_auth_users_inviter_source.sql); this applies the SAME fix
  // here, more directly -- supabase.auth.getUser() already returns the
  // caller's own user_metadata (the exact same jsonb signUp()'s own
  // options.data populates), so no second query, no profiles table, and
  // no RLS surface is needed at all. No email fallback: an inviter who
  // never set a display name resolves to null, exactly as
  // get_invitation_preview() already does, and buildInvitationEmail()
  // already renders that as "your campaign team" -- never an email.
  const { data: { user: caller } = { user: null } } = await supabase.auth.getUser();
  const invitedByName = caller?.user_metadata?.display_name?.trim() || null;

  const origin = Deno.env.get("SITE_ORIGIN") || req.headers.get("origin") || "https://electioncanon.org";
  const { subject, html, text } = buildInvitationEmail({
    invitation,
    campaignName: preview?.campaign_name ?? "an ElectionCanon campaign",
    geographyName: preview?.geography_name ?? null,
    geographyStateName: preview?.geography_state_name ?? null,
    geographyLgaName: preview?.geography_lga_name ?? null,
    geographyWardName: preview?.geography_ward_name ?? null,
    invitedByName,
    origin,
  });

  const from = Deno.env.get("RESEND_FROM_EMAIL") || "ElectionCanon <no-reply@electioncanon.org>";
  const resendBody = buildResendRequest({ from, to: invitation.invited_email, subject, html, text });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let vendorRes: Response;
    try {
      vendorRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify(resendBody),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    const vendorJson = await vendorRes.json().catch(() => null);
    const result = interpretResendResponse(vendorRes.status, vendorJson);
    if (!result.ok) return refuse(result.error, "PROVIDER_ERROR", 200);
    return json({ ok: true, code: "QUEUED", reason: null, providerMessageId: result.providerMessageId });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "AbortError";
    return refuse(timedOut ? "email provider timed out" : "email provider request failed", timedOut ? "PROVIDER_TIMEOUT" : "PROVIDER_UNREACHABLE", 200);
  }
});

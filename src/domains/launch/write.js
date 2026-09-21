// ============================================================
// LAUNCH DISTRIBUTION — WRITES  (Alpha 1.7; Brevo pass)
//
// Thin wrappers around the launch-subscribe/launch-confirm/launch-
// unsubscribe Edge Functions and the record-event SECURITY DEFINER RPC
// (20260921000000_election_launch_distribution.sql +
// supabase/functions/launch-*/). All authorization/validation logic
// lives there, not here -- same division of responsibility as
// src/domains/election/invitations/write.js.
//
// BREVO PASS: confirmLaunchSubscription()/unsubscribeLaunchSubscription()
// now call the launch-confirm/launch-unsubscribe Edge Functions instead
// of the confirm_launch_subscription()/unsubscribe_launch_subscription()
// RPCs directly. Those RPCs are UNCHANGED and still do the actual,
// privileged state transition -- the Edge Functions are thin wrappers
// that add a best-effort Brevo contact sync on top (see their own
// headers for why that sync needs a server-side secret and can't live
// in Postgres or the browser). Callers of these two functions see the
// same {ok, ..., error} shape as before; LaunchConfirm.jsx/
// LaunchUnsubscribe.jsx needed no changes.
//
// Every function here takes an explicit `client` and returns a plain
// {ok, ..., error} shape -- never throws for an expected failure (a
// demo-mode client, a network error, a validation rejection) -- so a
// caller never needs a try/catch around normal use. This mirrors the
// "channel independence" plain-function shape ARCHITECTURE.md describes
// for the election domain, applied here even though this is not
// election Canon data.
// ============================================================

export async function subscribeToLaunch({ client, email, sourceCampaign, referralId = null }) {
  if (!client) return { ok: false, error: "signups are not available in this preview" };
  try {
    const { data, error } = await client.functions.invoke("launch-subscribe", {
      body: { email, source_campaign: sourceCampaign, referral_id: referralId },
    });
    if (error) return { ok: false, error: error.message || "could not submit this signup" };
    if (!data?.ok) return { ok: false, error: data?.reason || "could not submit this signup" };
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err?.message || "could not submit this signup" };
  }
}

export async function confirmLaunchSubscription({ client, token }) {
  if (!client) return { ok: false, alreadyConfirmed: false, error: "confirmation is not available in this preview" };
  try {
    const { data, error } = await client.functions.invoke("launch-confirm", { body: { token } });
    if (error) return { ok: false, alreadyConfirmed: false, error: error.message || "this confirmation link is invalid or has expired" };
    if (!data?.ok) return { ok: false, alreadyConfirmed: false, error: data?.reason || "this confirmation link is invalid or has expired" };
    return { ok: true, alreadyConfirmed: !!data.alreadyConfirmed, error: null };
  } catch (err) {
    return { ok: false, alreadyConfirmed: false, error: err?.message || "this confirmation link is invalid or has expired" };
  }
}

export async function unsubscribeLaunchSubscription({ client, token }) {
  if (!client) return { ok: false, error: "unsubscribe is not available in this preview" };
  try {
    const { data, error } = await client.functions.invoke("launch-unsubscribe", { body: { token } });
    if (error) return { ok: false, error: error.message || "this unsubscribe link is invalid" };
    if (!data?.ok) return { ok: false, error: data?.reason || "this unsubscribe link is invalid" };
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err?.message || "this unsubscribe link is invalid" };
  }
}

/** Best-effort, never throws -- a failed analytics write must never break the page it's recording. */
export async function recordLaunchEvent({
  client, eventType, sourceCampaign = null, referralId = null,
  utmSource = null, utmMedium = null, utmCampaign = null, sessionId, path,
}) {
  if (!client || !sessionId || !path) return;
  try {
    await client.rpc("record_launch_analytics_event", {
      p_event_type: eventType,
      p_source_campaign: sourceCampaign,
      p_referral_id: referralId,
      p_utm_source: utmSource,
      p_utm_medium: utmMedium,
      p_utm_campaign: utmCampaign,
      p_session_id: sessionId,
      p_path: path,
    });
  } catch {
    // best effort -- analytics must never surface as a user-facing error
  }
}

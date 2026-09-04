// ============================================================
// FORGE OS — IDENTITY RUNTIME (Phase 1)
//
// Who is acting, what they are permitted to do, and what they have been
// told. Everything operational depends on this: a job cannot be accepted,
// a design cannot be approved and funding cannot be committed until the
// actor is accountable.
//
// Honest degradation: with no Supabase keys the app still runs, but it
// runs UNAUTHENTICATED and says so. There is no fake signed-in user —
// a demo identity would be a lie about who is accountable.
// ============================================================

import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabase, isConfigured } from "../lib/supabase";
import { capabilitiesFor, roleById, VERIFICATION_GATED } from "./Roles.js";
import { resolveProfile, RESOLUTION } from "./profileResolver.js";
import { linkProfileToOrganisation, isEstablished, shouldAudit } from "./organisationLink.js";

const IdentityContext = createContext(null);

export function ForgeIdentityProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [organisation, setOrganisation] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(Boolean(isConfigured));
  const [error, setError] = useState(null);

  // ---- session lifecycle ----
  useEffect(() => {
    if (!isConfigured) { setLoading(false); return; }
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data?.session ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!cancelled) setSession(s ?? null);
    });
    return () => { cancelled = true; sub?.subscription?.unsubscribe?.(); };
  }, []);

  const userId = session?.user?.id ?? null;

  // ---- profile ----
  //
  // Registration used to be the only thing that created a profile, via the
  // auth.users trigger. That left two holes this closes: a user who existed
  // BEFORE the identity schema was deployed can never be provisioned by an
  // AFTER INSERT trigger, and the trigger was observed DISABLED on this project
  // while sign-ups were still succeeding — producing an authenticated actor with
  // no profile and no way back.
  //
  // Session resolution now converges the profile through public.ensure_profile(),
  // a SECURITY DEFINER function that inserts only the id and returns the row.
  // The decision itself lives in profileResolver.js so every branch is unit
  // tested; this hook only owns the React concerns — the loop guard and the
  // visible error.
  //
  // LOOP SAFETY, three independent guards:
  //
  //   1. `ensureAttempts` is a REF, not state. Marking an attempt never triggers
  //      a render, so it cannot feed back into this effect.
  //   2. The RPC is attempted at most once per user identity (enforced in the
  //      resolver). A server-side refusal reports itself instead of retrying.
  //   3. The effect keys on `authKey` — a stable string — rather than on the
  //      session OBJECT. supabase-js emits a fresh session object on every
  //      TOKEN_REFRESHED, and getSession() plus onAuthStateChange both set it,
  //      so depending on the object would re-resolve on each of those. The key
  //      changes only when the actor or their authenticated-ness changes, which
  //      is exactly when the profile needs resolving again.
  const ensureAttempts = useRef(new Set());
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const authKey = `${userId ?? ""}|${session?.access_token ? "auth" : "anon"}`;

  const loadProfile = useCallback(async () => {
    const { outcome, profile: resolved, error: resolveError } = await resolveProfile({
      configured: isConfigured,
      session: sessionRef.current,
      client: supabase,
      hasAttempted: (id) => ensureAttempts.current.has(id),
      markAttempted: (id) => ensureAttempts.current.add(id),
    });

    setProfile(resolved);

    // Requirement: failures are explicit and visible. A resolution error is
    // NOT the same fact as "this actor has no profile", so it is surfaced
    // rather than collapsed into a null profile.
    if (resolveError) setError(resolveError);
    else if (outcome === RESOLUTION.EXISTING || outcome === RESOLUTION.ENSURED) setError(null);
  }, [authKey]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  // ---- organisation ----
  // A profile's organisation was previously only ever SELECTed as an id and
  // never resolved, so no surface could say which organisation an actor belongs
  // to. This reads the row itself, and reads nothing when the link is absent —
  // an actor without an organisation is a real and common state, not an error.
  const loadOrganisation = useCallback(async () => {
    if (!isConfigured || !profile?.organisation_id) { setOrganisation(null); return; }
    const { data, error: e } = await supabase
      .from("organisations")
      .select("id, name, role, rc_number, state, city, website, description, verification, created_by")
      .eq("id", profile.organisation_id)
      .maybeSingle();
    if (e) { setError(e.message); return; }
    setOrganisation(data ?? null);
  }, [profile?.organisation_id]);

  useEffect(() => { loadOrganisation(); }, [loadOrganisation]);

  // ---- notifications ----
  const loadNotifications = useCallback(async () => {
    if (!isConfigured || !userId) { setNotifications([]); return; }
    const { data } = await supabase
      .from("notifications")
      .select("id, kind, subject, body, entity, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(30);
    setNotifications(data ?? []);
  }, [userId]);

  useEffect(() => { loadNotifications(); }, [loadNotifications]);

  useEffect(() => {
    if (!isConfigured || !userId) return;
    const ch = supabase
      .channel("forge-notifications")
      .on("postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: `recipient=eq.${userId}` },
          (payload) => setNotifications((n) => [payload.new, ...n]))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  // ---- actions ----
  // ELECTIONCANON 1.1.1 PHASE A — `data` (previously discarded entirely)
  // is now inspected for exactly one honest fact: whether signUp() itself
  // actually created a session. Supabase only omits `data.session` when
  // email confirmation is genuinely required; when confirmation is OFF
  // for this project, signUp() returns an active session immediately and
  // no confirmation email is sent at all. `needsEmailConfirmation` lets a
  // caller (Access.jsx) show a "check your email" state ONLY when that is
  // what actually happened, never a fabricated claim — this is the one
  // caller of register() in this codebase (verified), so this additive
  // field changes nothing for anyone else.
  const register = useCallback(async ({ email, password, role, displayName, state, discipline }) => {
    if (!isConfigured) return { error: "Supabase is not configured in this environment." };
    const meta = {
      role,
      display_name: displayName ?? "",
      actor_kind: roleById(role)?.kind === "organisation" ? "organisation" : "individual",
      state: state ?? "",
      discipline: discipline ?? "",
    };
    const { data, error: e } = await supabase.auth.signUp({
      email, password, options: { data: meta },
    });
    return { error: e?.message ?? null, needsEmailConfirmation: !e && !data?.session };
  }, []);

  // ORGANISATION ONBOARDING.
  //
  // Registration created an authenticated PERSON and never an organisation, so
  // every profile the application produced had organisation_id null and the
  // `organisations` table could not be populated by any running code. This is
  // the smallest path that closes that gap, and it deliberately does very
  // little:
  //
  //   * it uses the existing table and the existing profiles.organisation_id.
  //     No second organisation model.
  //   * `role` must be supplied. It is never inferred from the person's own
  //     profile role, because a sheet-metal engineer may work for a logistics
  //     partner and guessing would put a false role on a real company.
  //   * `verification: "unverified"` is written explicitly. The RLS insert
  //     policy requires it, and being admitted is not being verified.
  //   * the uuid comes back from Postgres. Nothing here hardcodes one.
  //
  // IDEMPOTENT IN FOUR PLACES, because repeated registration is normal:
  //   1. an already-linked profile returns its organisation and writes nothing
  //   2. an organisation this user already created is reused, not duplicated
  //   3. the profile link is only written when it is actually absent
  //   4. ensure_business_owner() (below) is itself idempotent — `on conflict
  //      (organisation_id, person) do nothing` — so calling it again, on
  //      every onboarding/refresh, never creates a second membership row
  //
  // IT WILL NOT JOIN AN ORGANISATION SOMEBODY ELSE CREATED. Typing an existing
  // company's name must not attach you to it — that is impersonation, and the
  // authority to admit a colleague is an invitation model that does not exist
  // yet. Refused explicitly rather than quietly permitted.
  //
  // BUSINESS MEMBERSHIP BOOTSTRAP. `organisations`/`profiles.organisation_id`
  // (above) are the PUBLIC network-affiliation link — they say nothing about
  // Business Canon access, which is governed entirely by `organisation_members`
  // (20260820000000_business_membership.sql) and read by
  // `src/os/businessScope.js`. Until a membership row exists, an otherwise
  // fully-onboarded user has no Business scope and never can. `ensureMembership`
  // closes that gap by calling the EXISTING, already-tested, idempotent
  // `ensure_business_owner()` RPC — never a second membership mechanism, never
  // service_role, always under this authenticated user's own session, and only
  // ever able to succeed for an organisation this same user created (the RPC's
  // own internal check), which is exactly what `ensureOrganisation` guarantees.
  async function ensureMembership(organisationId) {
    const { error } = await supabase.rpc("ensure_business_owner", {
      p_organisation_id: organisationId,
    });
    return error?.message ?? null;
  }

  const ensureOrganisation = useCallback(async ({ name, role, state = null, city = null }) => {
    if (!isConfigured) return { error: "Supabase is not configured in this environment." };
    if (!userId)       return { error: "Sign in before establishing an organisation." };

    const clean = typeof name === "string" ? name.trim() : "";
    if (!clean) return { error: "An organisation name is required." };
    if (!role)  return { error: "An organisation role is required. It is never inferred." };

    // 1. already linked — nothing to do except make sure the Business
    //    membership bootstrap (below) has actually run for this organisation.
    //    A profile linked before that bootstrap existed would otherwise have
    //    no organisation_members row and no Business scope forever.
    if (profile?.organisation_id) {
      const { data } = await supabase
        .from("organisations").select("id, name, role, verification")
        .eq("id", profile.organisation_id).maybeSingle();
      const membershipError = data ? await ensureMembership(data.id) : null;
      return { organisation: data ?? null, created: false, error: null, membershipError };
    }

    // 2. reuse one this user already created. Scoped to created_by so the
    //    lookup can never surface, and then link to, another party's row.
    const { data: mine, error: findErr } = await supabase
      .from("organisations")
      .select("id, name, role, verification, created_by")
      .eq("created_by", userId)
      .ilike("name", clean)
      .maybeSingle();
    if (findErr) return { error: findErr.message };

    let org = mine ?? null;

    if (!org) {
      // Refuse to adopt a name already held by a different creator.
      const { data: taken } = await supabase
        .from("organisations").select("id, created_by").ilike("name", clean).limit(1);
      if (taken?.length && taken[0].created_by !== userId) {
        return {
          error: `"${clean}" is already registered by another account. ` +
                 `Joining an existing organisation requires an invitation from it, ` +
                 `which this deployment does not yet issue.`,
        };
      }

      const { data: created, error: insErr } = await supabase
        .from("organisations")
        .insert({ name: clean, role, state, city, created_by: userId, verification: "unverified" })
        .select("id, name, role, verification, created_by")
        .single();
      if (insErr) return { error: insErr.message };
      org = created;
    }

    // 3. link the profile, and PROVE it happened. `.is("organisation_id", null)`
    //    keeps the write conditional in the database rather than in this
    //    function, so two tabs
    //    racing cannot overwrite an existing link.
    //    The link, and the READING of the link, live in organisationLink.js so
    //    every outcome is unit tested. Success is never claimed unless the
    //    database confirms it.
    const { outcome, error: linkErr } = await linkProfileToOrganisation({
      client: supabase, userId, organisationId: org.id,
    });

    // 4. AUDIT ONLY A REAL, FRESH LINK.
    //    This is the second half of the defect: the audit event fired before the
    //    link was confirmed, so production accumulated three
    //    "organisation.established" records for a link that never existed.
    //    `shouldAudit` is true only for LINKED — not for a no-op, and never on a
    //    failure path.
    if (shouldAudit(outcome)) {
      await supabase.from("audit_events").insert({
        actor: userId, action: "organisation.established", entity: "organisation",
        entity_id: org.id, payload: { name: org.name, role: org.role },
      });
    }

    if (!isEstablished(outcome)) {
      // No organisation is created, no profile is fabricated, and nothing is
      // retried. The caller gets the reason and the surface renders it.
      return { organisation: org, created: !mine, linked: false, outcome, error: linkErr };
    }

    // 5. BOOTSTRAP BUSINESS MEMBERSHIP ON THE SAME, JUST-CONFIRMED LINK.
    //    ensure_business_owner() is the existing, already-tested, idempotent
    //    RPC (20260820000000_business_membership.sql) — not duplicated here,
    //    only called. It runs under this authenticated user's own identity
    //    (never service_role) and only ever succeeds for an organisation this
    //    same user created, which is exactly what step 2/3 above just did or
    //    reused. Without this call, organisation_members would stay empty and
    //    src/os/businessScope.js could never resolve a scope for this user —
    //    the exact gap Loop 4 found and this loop exists to close.
    const membershipError = await ensureMembership(org.id);

    await loadProfile();
    return { organisation: org, created: !mine, linked: true, outcome, error: null, membershipError };
  }, [userId, profile?.organisation_id, loadProfile]);

  const signIn = useCallback(async ({ email, password }) => {
    if (!isConfigured) return { error: "Supabase is not configured in this environment." };
    const { error: e } = await supabase.auth.signInWithPassword({ email, password });
    return { error: e?.message ?? null };
  }, []);

  // PRE-LAUNCH UX CLEANUP PASS (P1-4) — self-service password recovery.
  // Uses Supabase Auth's own built-in mechanism exclusively: no custom
  // password storage, no plaintext handling, no service-role credential.
  // `resetPasswordForEmail` always resolves the same way whether or not the
  // address has an account — Supabase itself does not distinguish, so
  // ElectionCanon cannot either without introducing an account-enumeration
  // leak. The email itself (sent by Supabase, not this app) carries the
  // secure recovery link; clicking it lands on /reset-password with a
  // short-lived recovery session supabase-js establishes automatically from
  // the URL, which updatePassword() below then uses.
  const requestPasswordReset = useCallback(async ({ email }) => {
    if (!isConfigured) return { error: "Supabase is not configured in this environment." };
    const clean = String(email ?? "").trim();
    if (!clean) return { error: "An email address is required." };
    const { error: e } = await supabase.auth.resetPasswordForEmail(clean, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    return { error: e?.message ?? null };
  }, []);

  // Only valid within the short-lived recovery session created by clicking
  // the emailed link — supabase-js rejects this otherwise, so there is no
  // separate authorization check to get wrong here.
  const updatePassword = useCallback(async ({ password }) => {
    if (!isConfigured) return { error: "Supabase is not configured in this environment." };
    const { error: e } = await supabase.auth.updateUser({ password });
    return { error: e?.message ?? null };
  }, []);

  const signOut = useCallback(async () => {
    if (!isConfigured) return;
    await supabase.auth.signOut();
    // Clear the loop guard so a later sign-in may attempt provisioning again.
    // Without this, a transient RPC failure would remain latched for the life of
    // the page and signing in again would report the stale refusal.
    ensureAttempts.current.clear();
    setProfile(null); setOrganisation(null); setNotifications([]); setError(null);
  }, []);

  const markRead = useCallback(async (id) => {
    if (!isConfigured) return;
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
    setNotifications((n) => n.map((x) => (x.id === id ? { ...x, read_at: new Date().toISOString() } : x)));
  }, []);

  // Append-only trail. Every operational action should call this.
  const record = useCallback(async (action, entity, entityId, payload = {}) => {
    if (!isConfigured || !userId) return;
    await supabase.from("audit_events").insert({
      actor: userId, action, entity, entity_id: entityId ?? null, payload,
    });
  }, [userId]);

  // ---- permissions ----
  const granted = useMemo(() => capabilitiesFor(profile?.role), [profile?.role]);
  const verified = profile?.verification === "verified";

  const can = useCallback((capability) => {
    if (!granted.includes(capability)) return false;
    // Authority that carries real-world consequence stays shut until verified.
    if (VERIFICATION_GATED.includes(capability) && !verified) return false;
    return true;
  }, [granted, verified]);

  const value = useMemo(() => ({
    configured: isConfigured,
    loading, error,
    session, user: session?.user ?? null, profile, organisation,
    role: profile?.role ?? null,
    roleMeta: roleById(profile?.role),
    verified,
    capabilities: granted,
    gatedCapabilities: granted.filter((c) => VERIFICATION_GATED.includes(c) && !verified),
    can,
    notifications,
    unreadCount: notifications.filter((n) => !n.read_at).length,
    register, signIn, signOut, markRead, record, ensureOrganisation,
    requestPasswordReset, updatePassword,
    refresh: () => { loadProfile(); loadOrganisation(); loadNotifications(); },
  }), [loading, error, session, profile, organisation, verified, granted, can, notifications,
       register, signIn, signOut, markRead, record, ensureOrganisation,
       requestPasswordReset, updatePassword,
       loadProfile, loadOrganisation, loadNotifications]);

  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity() {
  const ctx = useContext(IdentityContext);
  if (!ctx) throw new Error("useIdentity must be used inside <ForgeIdentityProvider>");
  return ctx;
}

export default ForgeIdentityProvider;

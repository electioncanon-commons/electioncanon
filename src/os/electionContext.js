// ============================================================
// FORGE ELECTION — ACTIVATION BOUNDARY  (Loop 25)
//
// The ONE channel-neutral entry point through which a campaign is created,
// its owner established, its scope resolved, and its Canon read — reusable
// unchanged by ForgeOS, a future WhatsApp channel, an independent web app,
// or an Edge Function. It assumes NOTHING about the caller except that it
// supplies an authenticated `userId` and an injected `client` — no React,
// no browser session, no conversation memory, no AI provider, no model.
//
// THIS FILE COMPOSES, IT DOES NOT REPLACE. `bootstrapCampaign()`
// (electionBootstrap.js) and `resolveElectionScope()` (electionScope.js)
// are UNCHANGED by this loop — this module calls them, in the order Loop
// 25's own brief specifies, and adds no third way to create a campaign or
// resolve scope. `projectElection()`/`deriveReadiness()`/
// `deriveObserverReadiness()` are equally unchanged as FUNCTIONS — this
// module's own contribution is wiring: pulling a campaign's real
// persisted rows out of `election_events` so those pure functions have
// something live to fold, mirroring the exact `fetchLog()`/
// `.map((r) => r.payload)` pattern `ForgeBusinessAssistantRoom.jsx`
// already uses for Business — extracted here so Election never needs a
// room to read its own Canon. ELECTIONCANON 1.1 PHASE 1 (BLOCKER FIX PASS
// F2) added a SECOND such wire, scoped to CANDIDATE_CAMPAIGN only: real
// responsibility_slots data (via coverage.js's existing
// getWardResponsibilityMap(), never a second query), so deriveReadiness()'s
// WARD_ASSIGNMENT dimension reflects the real Organisation system instead
// of defaulting to empty — see this function's own body below.
//
// WHY BOOTSTRAP'S OWN RETURN VALUE IS NEVER TRUSTED. Loop 24's CBOOT-8
// already proved `bootstrapCampaign()`'s success does not itself grant
// scope — only a real `campaign_members` row does. `activateElectionCampaign()`
// below keeps that discipline at this layer too: after bootstrap succeeds,
// it calls `resolveElectionScope()` AGAIN, independently, and reports
// failure if that independent check disagrees. A campaign is never
// reported as usable because bootstrap SAID so; only because the
// membership table, re-read, agrees.
// ============================================================

import { bootstrapCampaign, BOOTSTRAP, ACTOR_KIND } from "./electionBootstrap.js";
import { resolveElectionScope, isElectionScoped } from "./electionScope.js";
import { projectElection } from "../domains/election/projections.js";
import { deriveReadiness } from "../domains/election/studio/readiness.js";
import { deriveObserverReadiness } from "../domains/election/studio/observerReadiness.js";
// ELECTIONCANON 1.1 PHASE 1 (BLOCKER FIX PASS F2) — the ONE additional
// live read this loop adds: getWardResponsibilityMap() already exists in
// coverage.js (Phase 1's own coverage read model) — reused verbatim here,
// never a second responsibility query, never duplicated logic.
import { getWardResponsibilityMap } from "../domains/election/geography/coverage.js";

export { ACTOR_KIND };

/**
 * Every way campaign ACTIVATION can end. Deliberately not a renamed copy of
 * BOOTSTRAP or ELECTION_SCOPE — activation is a distinct concept (did the
 * CALLER end up with a usable, verified campaign?), so it earns its own
 * closed vocabulary rather than leaking bootstrap's/scope's internal states
 * upward.
 */
export const ACTIVATION = Object.freeze({
  UNAUTHENTICATED: "unauthenticated", // no userId at all
  CREATED:         "created",         // a brand-new campaign + owner membership, freshly verified
  ALREADY_MEMBER:  "already-member",  // the caller already has verified scope (new or reused campaign)
  REFUSED:         "refused",         // an explicitly requested campaign is not a real membership
  FAILED:          "failed",          // bootstrap/scope/read failure — see `error`
});

const activation = (outcome, extra = {}) =>
  Object.freeze({ outcome, campaignId: null, scope: null, error: null, ...extra });

/**
 * Activate Election access for an authenticated user — EITHER creating (or
 * idempotently reusing) a NAMED campaign they own, OR resolving to a
 * SPECIFIC campaign they already belong to (`requestedCampaign`). Exactly
 * one of `name`/`requestedCampaign` is meaningful per call; supplying
 * `requestedCampaign` always takes the verify-only path and never creates
 * anything — a caller "activating" into an existing campaign must already
 * be a real member, full stop (Phase 4E/10-A3/A4/A8's exact guarantee).
 *
 * @param userId             the authenticated actor's id — no default, ever
 * @param client             anything resolveElectionScope()/bootstrapCampaign() accept
 * @param name               a campaign label, for the CREATE-OR-REUSE path
 * @param requestedCampaign  a campaign id, for the VERIFY-ONLY path
 * @param actorKind          optional — forwarded to bootstrapCampaign() UNCHANGED
 *                           (see its own header); meaningless on the VERIFY-ONLY
 *                           path, since that path never creates anything.
 */
export async function activateElectionCampaign({ userId, client, name = null, requestedCampaign = null, actorKind } = {}) {
  if (!userId) return activation(ACTIVATION.UNAUTHENTICATED);

  if (requestedCampaign) {
    // VERIFY-ONLY. Never creates a campaign, never falls back to `name` even
    // if both were somehow supplied — an explicit campaign request is
    // either a real membership or it is refused, matching
    // resolveElectionScope()'s own `requested` contract exactly.
    const scope = await resolveElectionScope({ userId, client, requested: requestedCampaign });
    if (isElectionScoped(scope)) {
      return activation(ACTIVATION.ALREADY_MEMBER, { campaignId: scope.campaignId, scope });
    }
    return activation(ACTIVATION.REFUSED, {
      scope, error: scope.error ?? scope.reason ?? `no verified membership in ${requestedCampaign}`,
    });
  }

  const clean = typeof name === "string" ? name.trim() : "";
  if (!clean) return activation(ACTIVATION.FAILED, { error: "A campaign name is required to activate a new campaign." });

  const boot = await bootstrapCampaign({ userId, client, name: clean, actorKind });
  if (boot.outcome !== BOOTSTRAP.BOOTSTRAPPED) {
    return activation(ACTIVATION.FAILED, { error: boot.error ?? `bootstrap did not complete (${boot.outcome})` });
  }

  // NEVER TRUST bootstrap's own campaignId on its word alone — re-resolve
  // scope independently, the same discipline CBOOT-8 already proved at the
  // module level, enforced again at this boundary.
  const scope = await resolveElectionScope({ userId, client, requested: boot.campaignId });
  if (!isElectionScoped(scope)) {
    return activation(ACTIVATION.FAILED, {
      error: "bootstrap reported success but the membership could not be independently re-verified",
    });
  }

  return activation(boot.created ? ACTIVATION.CREATED : ACTIVATION.ALREADY_MEMBER,
    { campaignId: scope.campaignId, scope, actorKind: boot.actorKind });
}

/**
 * Pull a campaign's real persisted rows out of `election_events` — the ONE
 * new piece of plumbing this loop adds, extracted from the identical
 * pattern `ForgeBusinessAssistantRoom.jsx`'s `fetchLog()` already
 * establishes for Business, so Election stops needing a room to read its
 * own Canon. Returns raw event objects (`.payload`), ready for
 * `projectElection()` — never a folded view, never a claim.
 */
export async function loadElectionLog({ client, campaignId }) {
  if (!campaignId) return { events: [], error: null };
  const { data, error } = await client
    .from("election_events")
    .select("payload")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false });
  if (error) return { events: [], error: error.message };
  return { events: (data ?? []).map((r) => r.payload), error: null };
}

/**
 * Read a campaign's OWN actor_kind declaration — nothing else. A missing
 * row or a read error resolves to `null` (UNKNOWN), never a guessed
 * default; only `bootstrapCampaign()`'s own insert-time default
 * (CANDIDATE_CAMPAIGN) may ever supply that value, and only at creation.
 *
 * EXPORTED (LOOP 30) so `electionWebAdapter.js` can reuse this SAME
 * authoritative read for its write-time capability check, rather than a
 * second query mechanism inventing a parallel way to learn the same fact.
 */
export async function getCampaignActorKind({ client, campaignId }) {
  const { data, error } = await client.from("campaigns").select("actor_kind").eq("id", campaignId).maybeSingle();
  if (error || !data) return null;
  return data.actor_kind ?? null;
}

/**
 * THE READ-ONLY ELECTION APPLICATION CONTEXT. The single function any
 * channel calls to answer "what is this campaign's current state?":
 *
 *   authenticate -> resolveElectionScope -> read actor_kind
 *     -> (CANDIDATE_CAMPAIGN only) loadElectionLog
 *       -> projectElection -> (CANDIDATE_CAMPAIGN only) getWardResponsibilityMap
 *         -> deriveReadiness
 *
 * WHAT THIS FUNCTION REFUSES TO ACCEPT, BY CONSTRUCTION — not by a runtime
 * check, because the parameter simply does not exist: a caller-supplied
 * `view`, a caller-supplied `readiness`, a caller-supplied candidate/ward
 * fact, or any conversation/session object. The ONLY inputs are an
 * identity, a client, and an optional campaign hint — exactly
 * resolveElectionScope()'s own `requested` semantics, so a hostile or
 * model-supplied campaign id here is refused for the identical reason it
 * is refused there (see test A3/A4/A8).
 *
 * ACTOR-KIND GATING (LOOP 28, EXTENDED LOOP 29) — AN HONEST REFUSAL, OR THE
 * RIGHT SIBLING ENGINE, NEVER A SECOND CANON. `deriveReadiness()`'s three
 * candidate-specific dimensions and `deriveObserverReadiness()`'s one
 * observer-specific dimension are each called ONLY for the actor kind they
 * were built for — reading a `candidate.registered`/`campaign.ward.*` event
 * log means something genuinely different from an
 * `observer.assignment.recorded` one, and neither engine gains awareness of
 * the other's vocabulary. Every OTHER declared actor kind (NGO, monitoring
 * group, campaign support organisation, security/coordination organisation)
 * still has no authoritative event anywhere (Loop 28/29's own
 * reconnaissance found none), so this function refuses honestly for them:
 * `readiness: null`, `unsupportedActorKind: true`. This is NOT either
 * readiness engine gaining actor-kind awareness — both remain exactly as
 * pure and single-purpose as they always were; the ROUTING happens here,
 * one layer up, before either is ever called.
 */
export async function getElectionContext({ userId, client, requestedCampaign = null } = {}) {
  const scope = await resolveElectionScope({ userId, client, requested: requestedCampaign });
  if (!isElectionScoped(scope)) {
    return Object.freeze({ scope, view: null, readiness: null, actorKind: null, error: null });
  }

  const actorKind = await getCampaignActorKind({ client, campaignId: scope.campaignId });

  const deriveFor = {
    [ACTOR_KIND.CANDIDATE_CAMPAIGN]: deriveReadiness,
    [ACTOR_KIND.OBSERVER_ORGANISATION]: deriveObserverReadiness,
  }[actorKind];

  if (!deriveFor) {
    return Object.freeze({
      scope, view: null, readiness: null, actorKind, error: null, unsupportedActorKind: true,
    });
  }

  const { events, error } = await loadElectionLog({ client, campaignId: scope.campaignId });
  if (error) return Object.freeze({ scope, view: null, readiness: null, actorKind, error });

  // FRESH, EVERY CALL. No cache, no memoization across calls, no field on
  // `scope` or on this module carries state between invocations — the
  // Canon this returns is exactly what `election_events` holds AT THIS
  // MOMENT for this campaign, nothing carried over from a previous call.
  const view = projectElection(events, scope.campaignId);

  // ELECTIONCANON 1.1 PHASE 1 (BLOCKER FIX PASS F2) — WARD_ASSIGNMENT now
  // reads from responsibility_slots, not the legacy `ward.organisation`
  // field (see readiness.js's own header) — this is the one place that
  // real data enters the live app. Scoped to CANDIDATE_CAMPAIGN only:
  // deriveObserverReadiness() takes no such argument and has no
  // WARD_ASSIGNMENT-equivalent dimension to feed — completely unaffected,
  // called exactly as before. A failure fetching responsibility data
  // degrades to an EMPTY map (WARD_ASSIGNMENT honestly reads INCOMPLETE),
  // never a crash and never a fabricated COMPLETE — the same "never
  // fabricate" discipline readiness.js itself already follows; it does
  // NOT fail the whole context read, since CANDIDATE_REGISTERED/
  // WARD_STATUS_HEALTH must remain available even if this one extra read
  // has a problem.
  let readiness;
  if (actorKind === ACTOR_KIND.CANDIDATE_CAMPAIGN) {
    const wardIds = Object.keys(view.wards);
    const { data: wardResponsibility } = await getWardResponsibilityMap({ client, campaignId: scope.campaignId, wardIds });
    readiness = deriveReadiness(view, wardResponsibility ?? {});
  } else {
    readiness = deriveFor(view);
  }
  return Object.freeze({ scope, view, readiness, actorKind, error: null });
}

export default { ACTIVATION, activateElectionCampaign, loadElectionLog, getElectionContext, getCampaignActorKind };

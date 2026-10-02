import { getScopeGeographyRefs } from "./geography/read.js";

// ============================================================
// FORGE ELECTION — SHARED RESPONSIBILITY RESOLUTION  (Gate A)
//
// ONE way to answer "what is MY responsibility in this campaign" — replaces
// two independent, near-identical implementations found duplicated during
// the Gate A reconnaissance: OrganisationSection.jsx's private
// myOwnResponsibility() and HomeSection.jsx's inline myPersonRef/
// myResponsibility computation. Both read the SAME already-folded
// view.responsibilities (projectElection()'s own current-state fold over
// responsibility.assigned/reassigned events — see projections.js, which
// folds events oldest-first specifically so this map always holds each
// slot's CURRENT holder, never a stale one). This function performs no I/O
// of its own and introduces no second responsibility projection — it is a
// pure lookup over data the caller already has.
//
// IDENTITY CONVENTION, UNCHANGED: an accepted invitation's holder is keyed
// as `invite:${campaignId}:${userId}` everywhere in this codebase (see
// invitations/write.js's own header, write_responsibility()'s own
// v_new_person derivation) — this function reuses that exact convention,
// never a new one.
//
// WHY THIS NEVER TRUSTS A CALLER-SUPPLIED SCOPE. `view` must already be the
// caller's own resolved Canon (from getElectionContext(), itself gated by
// resolveElectionScope()'s real campaign_members check) — this function
// takes no geography id, role, or campaign id as a claim to verify; it only
// ever reads what the persisted event log already says about `userId`
// within `campaignId`. There is nothing here for a URL/query parameter to
// influence.
// ============================================================

/**
 * @param {object} view        the campaign's already-folded Canon (ctx.view)
 * @param {string} campaignId  the resolved, membership-verified campaign id
 * @param {string} userId      the authenticated caller's own auth.uid()
 * @returns {{campaignId: string, level: string, geographyRef: string,
 *            responsibilityRole: string, currentPersonRef: string} | null}
 */
export function resolveMyResponsibility({ view, campaignId, userId } = {}) {
  if (!view || !campaignId || !userId) return null;
  const myPersonRef = `invite:${campaignId}:${userId}`;
  const mine = Object.values(view.responsibilities ?? {}).find((r) => r.person === myPersonRef);
  if (!mine) return null;
  return {
    campaignId,
    level: mine.level,
    geographyRef: mine.geographyRef,
    responsibilityRole: mine.responsibilityRole,
    currentPersonRef: mine.person,
  };
}

// A Constituency Lead's own scope already IS the whole campaign's territory
// under the current single-constituency model (see HomeSection.jsx's
// original comment on MyScopeCard, and TerritoryExplorer.jsx's own "no
// constituency-level lead for a state-wide office; the campaign owner
// already leads it") — so for every Gate A "should this viewer get the
// campaign-wide experience or a scoped one" decision, a Constituency Lead
// is treated the SAME as owner/manager. Only the three genuinely
// sub-campaign roles get a scoped experience.
export const SCOPED_RESPONSIBILITY_ROLES = Object.freeze([
  "LGA_COORDINATOR", "WARD_COORDINATOR", "POLLING_UNIT_AGENT",
]);

export const isScopedResponsibility = (responsibility) =>
  Boolean(responsibility && SCOPED_RESPONSIBILITY_ROLES.includes(responsibility.responsibilityRole));

// ROLE_SCOPE_03 — THE canonical effective-scope object. Every surface that
// needs to decide "campaign-wide or narrowed to my geography" (Work, Ask,
// Election Operations) calls this ONE function rather than re-deriving the
// campaign-wide/scoped decision itself — Places (TerritorySection.jsx) and
// Canon (EventsSection.jsx) already made this same decision independently,
// via isScopedResponsibility(resolveMyResponsibility(...)); this wraps that
// exact same, unchanged logic in one reusable shape so new callers don't
// invent a second interpretation of it.
//
// `scopeGeographyRefs` is the caller's OWN responsibility.geographyRef plus
// its real descendants (see geography/read.js's getScopeGeographyRefs) —
// resolving descendants requires a read, so this function is async and
// callers await it once (e.g. in a useEffect keyed on the resolved
// responsibility), not on every render.
export async function resolveEffectiveScope({ client, view, campaignId, userId, membershipRole }) {
  const responsibility = resolveMyResponsibility({ view, campaignId, userId });
  const scoped = isScopedResponsibility(responsibility);
  if (!scoped) {
    return Object.freeze({
      campaignId, membershipRole, responsibilityRole: responsibility?.responsibilityRole ?? null,
      isCampaignWide: true, scopeLevel: null, scopeGeographyRef: null, scopeGeographyRefs: null,
    });
  }
  const { data: scopeGeographyRefs } = await getScopeGeographyRefs({
    client, level: responsibility.level, geographyRef: responsibility.geographyRef,
  });
  return Object.freeze({
    campaignId, membershipRole, responsibilityRole: responsibility.responsibilityRole,
    isCampaignWide: false, scopeLevel: responsibility.level, scopeGeographyRef: responsibility.geographyRef,
    scopeGeographyRefs,
  });
}

export default { resolveMyResponsibility, SCOPED_RESPONSIBILITY_ROLES, isScopedResponsibility, resolveEffectiveScope };

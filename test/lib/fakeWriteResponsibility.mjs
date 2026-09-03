// ============================================================
// SHARED TEST INFRASTRUCTURE — fake public.write_responsibility()
//
// Mirrors supabase/migrations/20260903000000_election_responsibility_
// reassignment.sql's write_responsibility() instruction-for-instruction —
// the SAME discipline test/election-invitations.consumer.mjs's own header
// already established for create_campaign_invitation()/
// accept_campaign_invitation(): these tests prove the SQL's own security
// ordering and authorization rules, not merely that a JS wrapper passes
// arguments through. Written and maintained in exactly ONE place so every
// consumer test that needs to simulate a real write_responsibility() call
// stays consistent with the actual migration, rather than three
// hand-rolled mocks slowly drifting apart.
//
// Operates on SHARED, CALLER-OWNED mutable state (`eventRows`,
// `campaignMembers`, `invitations`) — the same by-reference-array
// convention every existing fake client in this test suite already uses
// — so a test file's own `.from('election_events')` handler and this
// module's `.rpc('write_responsibility', ...)` handler see and mutate the
// exact same underlying log.
// ============================================================

/** Mirrors the migration's own one-time backfill: a plain 1:1 copy from
 *  existing responsibility.assigned rows, safe because at most one such
 *  row can exist per (campaign,level,geographyRef) — the real project's
 *  OWN partial unique index guarantees this, so this fake need not. */
export function backfillResponsibilitySlots(eventRows) {
  const slots = new Map();
  for (const row of eventRows) {
    if (row.type === "responsibility.assigned") {
      const key = `${row.campaign_id}|${row.payload.level}|${row.payload.geographyRef}`;
      if (!slots.has(key)) {
        slots.set(key, {
          campaign_id: row.campaign_id, level: row.payload.level, geography_ref: row.payload.geographyRef,
          responsibility_id: row.payload.responsibility, current_person: row.payload.person ?? null,
          responsibility_role: row.payload.responsibilityRole, current_event_id: row.event_id,
          updated_at: row.payload.at ?? new Date().toISOString(),
        });
      }
    }
  }
  return slots;
}

/**
 * Returns an async `(uid, params) => { data, error }` function matching
 * exactly what a fake client's `rpc("write_responsibility", params)`
 * handler should call, given the CURRENT authenticated uid.
 *
 * @param campaignMembers  shared array, `{campaign_id, person, member_role, status}[]`
 * @param eventRows        shared array, `{event_id, campaign_id, type, actor, payload}[]`
 * @param invitations      shared array of campaign_invitations-shaped rows
 *   (id, campaign_id, status, accepted_by, intended_level,
 *   intended_geography_ref, intended_responsibility_role)
 * @param geography        `{ wards: [{id,lgaId}], lgas: [{id}], pollingUnits: [{id,wardId}], constituencies: [{id}] }`
 * @param slots             a Map, typically from backfillResponsibilitySlots() —
 *   owned/mutated by this handler exactly like responsibility_slots itself.
 */
export function makeWriteResponsibilityHandler({ campaignMembers, eventRows, invitations = [], geography = {}, slots }) {
  function slotKey(campaignId, level, geographyRef) { return `${campaignId}|${level}|${geographyRef}`; }
  function currentMemberRole(campaignId, uid) {
    return campaignMembers.find((m) => m.campaign_id === campaignId && m.person === uid && m.status === "active")?.member_role ?? null;
  }
  function wardLga(wardId) { return (geography.wards ?? []).find((w) => w.id === wardId)?.lgaId ?? null; }
  function puWard(puId) { return (geography.pollingUnits ?? []).find((p) => p.id === puId)?.wardId ?? null; }
  function geographyIsReal(level, ref) {
    if (level === "ward") return (geography.wards ?? []).some((w) => w.id === ref);
    if (level === "lga") return (geography.lgas ?? []).some((l) => l.id === ref);
    if (level === "polling_unit") return (geography.pollingUnits ?? []).some((p) => p.id === ref);
    if (level === "constituency") return (geography.constituencies ?? []).some((c) => c.id === ref);
    return false;
  }

  return async function writeResponsibility(uid, params) {
    // 1. auth guard
    if (!uid) return { data: null, error: { message: "write_responsibility requires an authenticated session" } };

    // 2. active campaign membership guard
    const role = currentMemberRole(params.p_campaign_id, uid);
    if (!role) return { data: null, error: { message: "you are not an active member of this campaign" } };

    if (!["constituency", "lga", "ward", "polling_unit"].includes(params.p_level)) {
      return { data: null, error: { message: "invalid responsibility level" } };
    }
    if (!["CONSTITUENCY_LEAD", "LGA_COORDINATOR", "WARD_COORDINATOR", "POLLING_UNIT_AGENT"].includes(params.p_responsibility_role)) {
      return { data: null, error: { message: "invalid responsibility role" } };
    }

    // 3. authorization: invitation-trust OR normal delegation matrix.
    // NEVER derived from p_event_id.
    let authorised = false;
    if (params.p_via_invitation_id != null) {
      const inv = invitations.find((i) => i.id === params.p_via_invitation_id);
      if (!inv) return { data: null, error: { message: "referenced invitation does not exist" } };
      if (inv.campaign_id !== params.p_campaign_id) return { data: null, error: { message: "referenced invitation does not belong to this campaign" } };
      if (inv.status !== "accepted") return { data: null, error: { message: "referenced invitation has not been accepted" } };
      if (inv.accepted_by !== uid) return { data: null, error: { message: "referenced invitation was not accepted by the caller" } };
      if (inv.intended_level !== params.p_level || inv.intended_geography_ref !== params.p_geography_ref ||
          inv.intended_responsibility_role !== params.p_responsibility_role) {
        return { data: null, error: { message: "referenced invitation does not grant this role/geography" } };
      }
      authorised = true;
    } else if (role === "owner" || role === "manager") {
      authorised = true;
    } else if (params.p_responsibility_role === "WARD_COORDINATOR" && params.p_level === "ward") {
      const lgaId = wardLga(params.p_geography_ref);
      authorised = lgaId != null && slots.get(slotKey(params.p_campaign_id, "lga", lgaId))?.current_person === `invite:${params.p_campaign_id}:${uid}`;
    } else if (params.p_responsibility_role === "POLLING_UNIT_AGENT" && params.p_level === "polling_unit") {
      const wardId = puWard(params.p_geography_ref);
      authorised = wardId != null && slots.get(slotKey(params.p_campaign_id, "ward", wardId))?.current_person === `invite:${params.p_campaign_id}:${uid}`;
    }
    if (!authorised) return { data: null, error: { message: "you are not authorised to write this responsibility" } };

    // 4. target geography validation
    if (!geographyIsReal(params.p_level, params.p_geography_ref)) {
      return { data: null, error: { message: `unrecognised ${params.p_level} geography reference` } };
    }

    // 5. idempotency check — ONLY after full authorization + geography
    // validation, and cross-validated, never a bare event_id lookup.
    const existing = eventRows.find((r) => r.event_id === params.p_event_id);
    if (existing) {
      if (existing.campaign_id === params.p_campaign_id &&
          ["responsibility.assigned", "responsibility.reassigned"].includes(existing.type) &&
          existing.payload.level === params.p_level && existing.payload.geographyRef === params.p_geography_ref &&
          existing.actor === uid) {
        const slot = slots.get(slotKey(params.p_campaign_id, params.p_level, params.p_geography_ref));
        return { data: { ...slot, alreadyRecorded: true, payload: null }, error: null };
      }
      const err = new Error('duplicate key value violates unique constraint "election_events_event_id_key"');
      err.code = "23505";
      return { data: null, error: err };
    }

    // 6. current responsibility / compare-and-swap
    const key = slotKey(params.p_campaign_id, params.p_level, params.p_geography_ref);
    const slot = slots.get(key) ?? null;
    let responsibilityId, eventType;
    if (!slot) {
      if (params.p_expected_current_person != null) {
        return { data: null, error: { message: "this slot has already changed since you last viewed it -- refresh" } };
      }
      // Mirrors the real migration: reuse p_event_id as the
      // responsibility's own subject id (never a freshly minted one) —
      // matches pre-1.1 behavior AND gives reassignment a stable id to
      // reuse across the slot's whole lifetime.
      responsibilityId = params.p_event_id;
      eventType = "responsibility.assigned";
    } else {
      if (slot.current_person !== (params.p_expected_current_person ?? null)) {
        return { data: null, error: { message: "this slot has already changed since you last viewed it -- refresh" } };
      }
      responsibilityId = slot.responsibility_id;
      eventType = "responsibility.reassigned";
    }

    const newPerson = params.p_via_invitation_id != null ? `invite:${params.p_campaign_id}:${uid}` : (params.p_new_person ?? null);

    if (eventType === "responsibility.reassigned" && newPerson === (slot?.current_person ?? null)) {
      return { data: null, error: { message: "this person already holds this responsibility" } };
    }

    const at = new Date().toISOString();
    let payload;
    if (eventType === "responsibility.assigned") {
      payload = {
        type: eventType, responsibility: responsibilityId, campaign: params.p_campaign_id,
        level: params.p_level, geographyRef: params.p_geography_ref, responsibilityRole: params.p_responsibility_role,
        person: newPerson, status: "ASSIGNED", eventId: params.p_event_id, at,
        summary: `${params.p_responsibility_role} assigned for ${params.p_level} ${params.p_geography_ref}`,
      };
    } else {
      payload = {
        type: eventType, responsibility: responsibilityId, campaign: params.p_campaign_id,
        level: params.p_level, geographyRef: params.p_geography_ref, responsibilityRole: params.p_responsibility_role,
        previousPerson: slot?.current_person ?? null, newPerson, reason: params.p_reason ?? null,
        eventId: params.p_event_id, at,
        summary: `${params.p_level} ${params.p_geography_ref}${newPerson == null ? " vacated" : " reassigned"}`,
      };
    }

    // 7. atomic write — one JS synchronous section, mirroring the SQL
    // function's own one-transaction guarantee: both mutations below
    // always happen together, nothing else can interleave in single-
    // threaded JS between them.
    eventRows.push({ event_id: params.p_event_id, campaign_id: params.p_campaign_id, type: eventType, actor: uid, payload });
    const newSlot = {
      campaign_id: params.p_campaign_id, level: params.p_level, geography_ref: params.p_geography_ref,
      responsibility_id: responsibilityId, current_person: newPerson, responsibility_role: params.p_responsibility_role,
      current_event_id: params.p_event_id, updated_at: at,
    };
    slots.set(key, newSlot);

    return { data: { ...newSlot, alreadyRecorded: false, payload }, error: null };
  };
}

export default { backfillResponsibilitySlots, makeWriteResponsibilityHandler };

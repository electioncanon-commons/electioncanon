// ============================================================
// OUTREACH ACTIVATION — HISTORICAL IMPORT RECONCILIATION  (Phase 7 fix)
//
// THE BUG THIS FIXES. import.js's normalizeImportRow()/detectDuplicates()
// correctly CLASSIFY a historical row as "duplicate_existing" when its
// email already matches a real outreach_contacts row -- but nothing in
// this codebase ever did anything with that classification beyond
// reporting it. OutreachControlRoom.jsx's ImportView only ever submitted
// rows classified "new"; the Edge Function's import_contacts action only
// ever inserts a brand-new row or increments a counter for a duplicate.
// A "duplicate_existing" historical message -- real evidence that a real
// letter was sent -- was silently discarded. This file is the missing
// third path: RECONCILE a historical message against the contact it
// belongs to, WITHOUT creating a second contact row for the same email
// (outreach_contacts has exactly one row per lower(recipient_email), by
// the migration's own unique index) and WITHOUT ever overwriting a
// contact that has already moved past DRAFT in its real pipeline.
//
// WHY THIS REUSES outreach_status_changes RATHER THAN A NEW TABLE. That
// table is already the append-only "fact about what was known at that
// moment" ledger (see the migration's own header) and
// validateStatusTransition() already treats fromStatus === toStatus as a
// valid no-op -- exactly the shape needed to log "this message was sent"
// against a contact whose current status must not move. No migration,
// no new table, no parallel subsystem.
//
// THE NOTE-PREFIX CONVENTION IS THE IDEMPOTENCY KEY. Because
// outreach_status_changes has no dedicated "source message id" column,
// every row this module proposes encodes its Gmail/source message id as
// a stable, greppable prefix -- HISTORICAL_EVENT_PREFIX(ref) below. A
// caller that already queried a contact's existing outreach_status_changes
// notes can pass them to hasHistoricalEvent()/dedupeBySourceRef() to
// decide whether a given historical row has already been recorded, which
// is what makes re-importing the exact same source file a safe no-op
// (Objective 3.5: idempotent re-import).
//
// GROUPING BY EMAIL, NOT BY ROW. outreach_contacts allows exactly one row
// per email. Two historical rows for the same brand-new email cannot both
// become "new contacts" -- the earliest-sent one becomes the contact, the
// rest become historical events attached to it once it exists. Two rows
// for an email that ALREADY has a contact never create anything new --
// every one of them is a historical event against that one contact.
// planHistoricalReconciliation() groups by normalized email FIRST, then
// classifies, so this distinction is never left to chance.
//
// WHAT THIS FILE NEVER DOES. It never regresses a contact's status (a
// contact already past DRAFT is only ever appended to, never patched). It
// never guesses which of several candidate addresses in one field is the
// "real" recipient -- a field with more than one address is always
// needs_review. It never marks anything DELIVERED/RESPONDED from Sent-
// folder-shaped evidence -- see buildContactPatch() below, which touches
// only status/sent_at/delivery_status=SENT and the identity/evidence
// fields (sender_account, source_record_ref, subject, campaign,
// letter_version, country), and only when the existing value is empty.
//
// PURE, LOCAL-ONLY: no fs, no network, no Supabase client, no React --
// same discipline as model.js/import.js/reconcile.js (see
// test/election-outreach-launch-separation.consumer.mjs, which this file
// is added to).
// ============================================================

import { normalizeImportRow } from "./import.js";

export const HISTORICAL_EVENT_PREFIX = "[historical_import:";

const EMAIL_RE = /[^\s<>",;]+@[^\s<>",;]+\.[^\s<>",;]+/g;
const UNKNOWN_PLACEHOLDER_RE = /^unknown\b/i;

function normalizeKey(v) {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

/**
 * Counts distinct-looking email addresses found in a raw field value.
 * Used to detect a field that actually holds more than one recipient
 * (e.g. "a@b.org; c@d.org") -- such a field is never silently resolved
 * to "the first address"; see classifyRawRow() below.
 */
export function countEmailAddresses(raw) {
  if (typeof raw !== "string") return 0;
  const found = raw.match(EMAIL_RE) || [];
  return new Set(found.map((e) => e.trim().toLowerCase())).size;
}

/**
 * True when a raw field value is a placeholder sentence standing in for
 * "we don't know" (e.g. "UNKNOWN — not present in source tracker") rather
 * than a real value. The schema's own convention for "unknown" is null --
 * never a descriptive sentence baked into a text column. Deliberately
 * narrow (must literally start with "unknown") so a real value is never
 * mistaken for a placeholder.
 */
export function isUnknownPlaceholder(raw) {
  return typeof raw === "string" && UNKNOWN_PLACEHOLDER_RE.test(raw.trim());
}

/** Returns the input unchanged, except an UNKNOWN-placeholder sentence becomes null. */
export function cleanPlaceholder(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return isUnknownPlaceholder(s) ? null : s;
}

/**
 * Builds the note text one historical outreach_status_changes row
 * carries. The HISTORICAL_EVENT_PREFIX(sourceRecordRef) segment is the
 * idempotency key -- see hasHistoricalEvent() below. sourceRecordRef is
 * required (a historical event with no source reference is not
 * re-identifiable, so callers must not invoke this without one).
 */
export function buildHistoricalNote({ sourceRecordRef, subject, sentAtIso, senderAccount, campaign, letterVersion }) {
  const parts = [`${HISTORICAL_EVENT_PREFIX}${sourceRecordRef}]`];
  parts.push(subject ? `"${subject}"` : "(no subject recorded)");
  parts.push(sentAtIso ? `sent ${sentAtIso}` : "sent date unknown");
  parts.push(`via ${senderAccount || "UNKNOWN"}`);
  if (campaign) parts.push(`campaign: ${campaign}`);
  if (letterVersion) parts.push(`letter_version: ${letterVersion}`);
  return parts.join(" — ");
}

/** True when `existingNotes` (any iterable of note strings already recorded for a contact) already contains this exact source reference. */
export function hasHistoricalEvent(existingNotes, sourceRecordRef) {
  if (!sourceRecordRef) return false;
  const needle = `${HISTORICAL_EVENT_PREFIX}${sourceRecordRef}]`;
  for (const note of existingNotes || []) {
    if (typeof note === "string" && note.includes(needle)) return true;
  }
  return false;
}

/**
 * One raw row's pre-classification, BEFORE grouping by email. Separates
 * the two genuinely different failure shapes Objective 2/3 call out:
 * - "invalid": the row is unusable on its own terms (no organization, or
 *   a single recipient field that still isn't a parseable email once the
 *   multi-address case below is ruled out).
 * - "needs_review": the row parses but is AMBIGUOUS -- more than one
 *   recipient address in the email field. Never silently resolved to
 *   "the first address" or split into multiple contacts on this
 *   function's own authority.
 * A row that passes both checks is hydrated via normalizeImportRow() (the
 * existing, already-correct field mapping) and returned as "ok".
 */
export function classifyRawRow(raw, rowIndex) {
  const organization = typeof raw?.organization === "string" ? raw.organization.trim() : "";
  if (!organization) {
    return { rowIndex, status: "invalid", reason: "organization is required", raw };
  }

  const emailField = typeof raw?.email === "string" ? raw.email : "";
  const addressCount = countEmailAddresses(emailField);
  if (addressCount > 1) {
    return {
      rowIndex, status: "needs_review", raw,
      reason: `this row's email field contains ${addressCount} distinct recipient addresses ("${emailField.trim()}") -- a human must decide which one (if any) is the actual contact; never auto-assigned`,
    };
  }

  // Fold any "UNKNOWN — ..." placeholder sentence in country/campaign back to null
  // before handing the row to normalizeImportRow(), so it is never stored verbatim.
  const cleaned = { ...raw, country: cleanPlaceholder(raw?.country), campaign: cleanPlaceholder(raw?.campaign) };

  const normalized = normalizeImportRow(cleaned);
  if (!normalized.valid) {
    return { rowIndex, status: "invalid", reason: normalized.error, raw };
  }
  return { rowIndex, status: "ok", raw, contact: normalized.contact };
}

/**
 * Proposes the contact-field backfill for an existing contact that has
 * never actually been evidenced as sent (status still DRAFT, sent_at
 * still null). Returns null -- meaning "do not touch this contact's
 * fields at all" -- whenever the contact has already moved past DRAFT or
 * already has a sent_at, which is the "never regress/overwrite a more-
 * advanced contact" rule (Objective 3.2/3.4 and Objective 4). Existing
 * non-empty fields (sender_account other than UNKNOWN, source_record_ref,
 * subject, campaign, letter_version, country) are never overwritten --
 * only an empty/UNKNOWN slot is ever filled in, and only from the
 * EARLIEST historical message matched to this contact.
 */
export function buildContactPatch(existingContact, earliestMatch) {
  if (!existingContact || existingContact.status !== "DRAFT" || existingContact.sentAt) return null;
  if (!earliestMatch?.contact?.sentAt) return null;

  const patch = {
    status: "SENT",
    sentAt: earliestMatch.contact.sentAt,
    deliveryStatus: "SENT",
  };
  if ((!existingContact.senderAccount || existingContact.senderAccount === "UNKNOWN") && earliestMatch.contact.senderAccount && earliestMatch.contact.senderAccount !== "UNKNOWN") {
    patch.senderAccount = earliestMatch.contact.senderAccount;
  }
  if (!existingContact.sourceRecordRef && earliestMatch.contact.sourceRecordRef) patch.sourceRecordRef = earliestMatch.contact.sourceRecordRef;
  if (!existingContact.subject && earliestMatch.contact.subject) patch.subject = earliestMatch.contact.subject;
  if (!existingContact.campaign && earliestMatch.contact.campaign) patch.campaign = earliestMatch.contact.campaign;
  if (!existingContact.letterVersion && earliestMatch.contact.letterVersion) patch.letterVersion = earliestMatch.contact.letterVersion;
  if (!existingContact.country && earliestMatch.contact.country) patch.country = earliestMatch.contact.country;
  return patch;
}

function sentAtMillis(contact) {
  if (!contact?.sentAt) return Number.POSITIVE_INFINITY; // undated rows never win "earliest"
  const t = new Date(contact.sentAt).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/**
 * The full historical-import reconciliation plan. Never mutates its
 * arguments.
 *
 * rawRows: raw parsed CSV/JSON row objects (import.js's parseImportRows()
 *   output), in original file order.
 * existingContacts: full contact records already in outreach_contacts,
 *   camelCase-shaped exactly like OutreachControlRoom.jsx's
 *   toCamelContact() output (must include at least id, recipientEmail,
 *   status, sentAt, senderAccount, sourceRecordRef, subject, campaign,
 *   letterVersion, country).
 * existingEventRefsByEmail: optional Map/plain-object of
 *   normalizedEmail -> iterable of outreach_status_changes note strings
 *   already recorded for that contact (what the caller already read from
 *   the database). Omit (or pass {}) when there is nothing to check yet.
 *
 * Returns { toCreate, toAttachExisting, toAttachNewBatch, alreadyRecorded,
 *   needsReview, invalid, summary }. Every "toCreate"/"toAttach*" entry
 *   also carries the historicalEvent note+sourceRecordRef this plan
 *   proposes writing, so a caller can both create/patch the contact AND
 *   append the status-change row in the same pass.
 */
export function planHistoricalReconciliation(rawRows, existingContacts = [], existingEventRefsByEmail = {}) {
  const existingByEmail = new Map(
    (existingContacts || []).map((c) => [normalizeKey(c.recipientEmail), c])
  );
  const refsByEmail = existingEventRefsByEmail instanceof Map
    ? existingEventRefsByEmail
    : new Map(Object.entries(existingEventRefsByEmail || {}));

  const invalid = [];
  const needsReview = [];
  const okRows = [];

  (rawRows || []).forEach((raw, rowIndex) => {
    const classified = classifyRawRow(raw, rowIndex);
    if (classified.status === "invalid") invalid.push(classified);
    else if (classified.status === "needs_review") needsReview.push(classified);
    else okRows.push(classified);
  });

  // Group the parseable rows by normalized recipient email.
  const groups = new Map();
  okRows.forEach((row) => {
    const email = normalizeKey(row.contact.recipientEmail);
    if (!groups.has(email)) groups.set(email, []);
    groups.get(email).push(row);
  });

  const toCreate = [];
  const toAttachExisting = [];
  const toAttachNewBatch = [];
  const alreadyRecorded = [];

  for (const [email, rows] of groups.entries()) {
    const existingContact = existingByEmail.get(email);
    const recordedNotes = refsByEmail.get(email) || [];

    if (existingContact) {
      // Every row in this group is a historical event against the SAME existing contact -- never a new one.
      const sorted = [...rows].sort((a, b) => sentAtMillis(a.contact) - sentAtMillis(b.contact));
      const earliestMatch = sorted[0];
      const patch = buildContactPatch(existingContact, earliestMatch);
      rows.forEach((row) => {
        const ref = row.contact.sourceRecordRef;
        if (hasHistoricalEvent(recordedNotes, ref)) {
          alreadyRecorded.push({ ...row, existingContactId: existingContact.id, reason: `a historical event for source_record_ref "${ref}" is already recorded against this contact` });
          return;
        }
        toAttachExisting.push({
          ...row,
          existingContactId: existingContact.id,
          contactPatch: row === earliestMatch ? patch : null, // the backfill (if any) is applied once, not once per message
          historicalEvent: {
            sourceRecordRef: ref,
            fromStatus: existingContact.status,
            toStatus: patch ? "SENT" : existingContact.status, // a no-op transition when the contact is left untouched
            changedAt: row.contact.sentAt,
            note: buildHistoricalNote({
              sourceRecordRef: ref, subject: row.contact.subject, sentAtIso: row.contact.sentAt,
              senderAccount: row.contact.senderAccount, campaign: row.contact.campaign, letterVersion: row.contact.letterVersion,
            }),
          },
        });
      });
    } else {
      // No existing contact for this email -- the earliest-sent row becomes the new contact; the rest attach to it once created.
      const sorted = [...rows].sort((a, b) => sentAtMillis(a.contact) - sentAtMillis(b.contact));
      const [primary, ...rest] = sorted;
      toCreate.push({
        ...primary,
        groupEmail: email,
        historicalEvent: primary.contact.sentAt ? {
          sourceRecordRef: primary.contact.sourceRecordRef,
          fromStatus: "DRAFT",
          toStatus: primary.contact.status,
          changedAt: primary.contact.sentAt,
          note: buildHistoricalNote({
            sourceRecordRef: primary.contact.sourceRecordRef, subject: primary.contact.subject, sentAtIso: primary.contact.sentAt,
            senderAccount: primary.contact.senderAccount, campaign: primary.contact.campaign, letterVersion: primary.contact.letterVersion,
          }),
        } : null,
      });
      rest.forEach((row) => {
        toAttachNewBatch.push({
          ...row,
          groupEmail: email,
          historicalEvent: {
            sourceRecordRef: row.contact.sourceRecordRef,
            fromStatus: primary.contact.status,
            toStatus: primary.contact.status,
            changedAt: row.contact.sentAt,
            note: buildHistoricalNote({
              sourceRecordRef: row.contact.sourceRecordRef, subject: row.contact.subject, sentAtIso: row.contact.sentAt,
              senderAccount: row.contact.senderAccount, campaign: row.contact.campaign, letterVersion: row.contact.letterVersion,
            }),
          },
        });
      });
    }
  }

  return {
    toCreate, toAttachExisting, toAttachNewBatch, alreadyRecorded, needsReview, invalid,
    summary: {
      newContacts: toCreate.length,
      linkedToExisting: toAttachExisting.length,
      linkedToNewBatch: toAttachNewBatch.length,
      alreadyRecorded: alreadyRecorded.length,
      needsReview: needsReview.length,
      invalid: invalid.length,
      totalRows: (rawRows || []).length,
    },
  };
}

export default {
  HISTORICAL_EVENT_PREFIX, countEmailAddresses, isUnknownPlaceholder, cleanPlaceholder,
  buildHistoricalNote, hasHistoricalEvent, classifyRawRow, buildContactPatch, planHistoricalReconciliation,
};

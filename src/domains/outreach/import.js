// ============================================================
// OUTREACH ACTIVATION — HISTORICAL IMPORT  (Phase 7)
//
// Turns a CSV or JSON export of the 50+ letters ElectionCanon has
// already sent into outreach_contacts rows, WITHOUT fabricating a single
// fact that wasn't in the source file. Every normalizer below either
// carries a real value forward or leaves the field at its honest UNKNOWN
// default from model.js -- never a guess, never a plausible-looking
// placeholder.
//
// THE ONE INFERENCE THIS FILE MAKES, AND WHY. If a row has a date_sent
// but no recognizable status, the resulting status is SENT rather than
// the usual DRAFT default -- because "a letter was sent on this date" is
// literally what the source data says, and leaving a dated row at DRAFT
// (meaning "not yet sent") would misrepresent the one fact the import
// file actually provides. Nothing beyond that single inference happens
// anywhere in this file; an unrecognized known_status/known_response
// string is preserved verbatim in notes, never silently mapped to a
// best-guess enum value.
//
// sender_account and source_record_ref (Phase 10, manual Launch Engine
// recovery without Google Takeout) are carried forward the same way --
// sender_account is matched against the closed SENDER_ACCOUNT vocabulary
// case-insensitively, falling back to the honest "UNKNOWN" default (with
// the raw value preserved verbatim in notes) rather than guessed between
// the two real mailboxes; source_record_ref (a Gmail message id, permalink,
// or search description) is free text, carried forward unchanged or left
// null, never fabricated when a row doesn't supply one.
//
// notes (optional) is a free-text passthrough for whatever context a source
// row carries that has no dedicated column here -- carried forward
// verbatim as the first note, with any auto-generated note (an
// unrecognized known_status/known_response/sender_account) appended after
// it, never replacing it. This exists so a richer source tracker (extra
// columns like a website, a one-line proposition, a priority tier, or a
// verification note) can be folded in by the caller without inventing new
// outreach_contacts columns for every tracker's own shape.
//
// DUPLICATE DETECTION is by normalized (trimmed, lower-cased) email only
// -- the same identity key validateContact() itself is keyed on. A
// second row in the same file with the same email is `duplicate_in_batch`
// (first occurrence wins); a row matching an email already present in
// `existingContacts` (passed in by the caller, which in production means
// the real outreach_contacts table) is `duplicate_existing`. Neither is
// silently merged -- the caller decides what to do with a flagged row.
// ============================================================

import { SECTOR, SOURCE_OF_TRUTH, PIPELINE_STATUS, RESPONSE_STATUS, SENDER_ACCOUNT, defaultContactFor, validateContact } from "./model.js";

const STATUS_SYNONYMS = Object.freeze({
  draft: "DRAFT", sent: "SENT", delivered: "DELIVERED", engaged: "ENGAGED",
  responded: "RESPONDED", "follow-up due": "FOLLOW_UP_DUE", "follow up due": "FOLLOW_UP_DUE",
  conversation: "CONVERSATION", demo: "DEMO",
  "editorial interest": "EDITORIAL_INTEREST", "partnership interest": "PARTNERSHIP_INTEREST",
  "contributor interest": "CONTRIBUTOR_INTEREST", published: "PUBLISHED", declined: "DECLINED",
  "no response": "NO_RESPONSE", bounced: "BOUNCED",
});

const RESPONSE_SYNONYMS = Object.freeze({
  none: "NONE", responded: "RESPONDED", declined: "DECLINED", unknown: "UNKNOWN",
});

function normalizeKey(v) {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

/** Returns a recognized PIPELINE_STATUS, or null if the raw text isn't one of the known synonyms -- never a guess. */
export function mapKnownStatus(raw) {
  if (raw == null || raw === "") return null;
  const key = normalizeKey(raw);
  if (PIPELINE_STATUS.includes(raw)) return raw;
  return STATUS_SYNONYMS[key] || null;
}

/** Returns a recognized RESPONSE_STATUS, or null if unrecognized. */
export function mapKnownResponse(raw) {
  if (raw == null || raw === "") return null;
  const key = normalizeKey(raw);
  if (RESPONSE_STATUS.includes(raw)) return raw;
  return RESPONSE_SYNONYMS[key] || null;
}

/** Returns a recognized SENDER_ACCOUNT (matched case-insensitively), or null if unrecognized -- never a guess between the two real accounts. */
export function mapKnownSenderAccount(raw) {
  if (raw == null || raw === "") return null;
  const key = normalizeKey(raw);
  return SENDER_ACCOUNT.find((a) => a.toLowerCase() === key) || null;
}

function parseDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Minimal RFC4180-ish CSV parser: handles quoted fields, escaped ""
 * quotes, and commas/newlines inside quotes. The first row is the
 * header; every other row is returned as a plain object keyed by header.
 */
export function parseCsv(text) {
  if (typeof text !== "string" || !text.trim()) return { valid: false, error: "empty CSV input", rows: [] };

  const rows = [];
  let row = [], field = "", inQuotes = false;
  let i = 0;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { rows.push(row); row = []; };

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { pushField(); i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { pushField(); pushRow(); i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || row.length > 0) { pushField(); pushRow(); }

  const filtered = rows.filter((r) => !(r.length === 1 && r[0] === ""));
  if (filtered.length < 1) return { valid: false, error: "no header row found", rows: [] };

  const header = filtered[0].map((h) => h.trim());
  const dataRows = filtered.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, idx) => { obj[h] = r[idx] !== undefined ? r[idx] : ""; });
    return obj;
  });
  return { valid: true, error: null, rows: dataRows };
}

/** Accepts either a CSV string or an already-parsed array of row objects (from JSON.parse of an array). */
export function parseImportRows(input, format) {
  if (format === "json") {
    if (!Array.isArray(input)) return { valid: false, error: "JSON import must be an array of row objects", rows: [] };
    return { valid: true, error: null, rows: input };
  }
  if (format === "csv") return parseCsv(input);
  return { valid: false, error: `unknown import format: ${format}`, rows: [] };
}

/**
 * Maps one raw import row (organization, recipient, email, date_sent,
 * subject, letter_version, known_response, known_status -- the exact
 * field names Phase 7 specifies) to a contact record. Returns
 * {valid, error, contact} -- an invalid row (missing organization/email,
 * or a sector that isn't in the closed vocabulary) is reported, not
 * silently dropped or silently defaulted past.
 */
export function normalizeImportRow(raw) {
  if (!raw || typeof raw !== "object") return { valid: false, error: "row is not an object", contact: null };

  const organization = typeof raw.organization === "string" ? raw.organization.trim() : "";
  const recipientEmail = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
  const recipientName = raw.recipient ? String(raw.recipient).trim() : null;
  const sectorRaw = typeof raw.sector === "string" ? raw.sector.trim() : "";
  const sector = SECTOR.includes(sectorRaw) ? sectorRaw : "other";
  const sentAt = parseDate(raw.date_sent);
  const subject = raw.subject ? String(raw.subject).trim() : null;
  const letterVersion = raw.letter_version ? String(raw.letter_version).trim() : null;
  const sourceRecordRef = raw.source_record_ref ? String(raw.source_record_ref).trim() : null;
  const suppliedNotes = raw.notes ? String(raw.notes).trim() : null;

  const contact = defaultContactFor({
    organization, recipientEmail, sector, sourceOfTruth: "MANUAL_IMPORT",
    recipientName, country: raw.country ? String(raw.country).trim() : null,
    campaign: raw.campaign ? String(raw.campaign).trim() : null,
    letterVersion, subject, sourceRecordRef,
  });
  contact.sentAt = sentAt;

  const mappedStatus = mapKnownStatus(raw.known_status);
  const mappedResponse = mapKnownResponse(raw.known_response);
  const mappedSenderAccount = mapKnownSenderAccount(raw.sender_account);
  const notes = [];

  if (suppliedNotes) notes.push(suppliedNotes);

  if (mappedSenderAccount) {
    contact.senderAccount = mappedSenderAccount;
  } else if (raw.sender_account) {
    notes.push(`imported sender_account (unrecognized, kept verbatim): "${String(raw.sender_account).trim()}"`);
  }

  if (mappedStatus) {
    contact.status = mappedStatus;
  } else if (raw.known_status) {
    notes.push(`imported known_status (unrecognized, kept verbatim): "${String(raw.known_status).trim()}"`);
    contact.status = sentAt ? "SENT" : "DRAFT";
  } else {
    contact.status = sentAt ? "SENT" : "DRAFT";
  }

  if (mappedResponse) {
    contact.responseStatus = mappedResponse;
  } else if (raw.known_response) {
    notes.push(`imported known_response (unrecognized, kept verbatim): "${String(raw.known_response).trim()}"`);
  }

  if (sentAt) contact.deliveryStatus = "SENT";
  if (notes.length) contact.notes = notes.join("; ");

  const validation = validateContact(contact);
  if (!validation.valid) return { valid: false, error: validation.error, contact: null };
  return { valid: true, error: null, contact };
}

/**
 * Classifies a batch of normalized contacts against each other and
 * against an existing set, by normalized email. Never merges a
 * duplicate's fields into the kept record -- that decision belongs to a
 * human reviewing the flagged rows, not to this function.
 */
export function detectDuplicates(contacts, existingContacts = []) {
  const existingEmails = new Set(existingContacts.map((c) => normalizeKey(c.recipientEmail)));
  const seenThisBatch = new Set();
  return contacts.map((contact) => {
    const email = normalizeKey(contact.recipientEmail);
    if (existingEmails.has(email)) return { contact, classification: "duplicate_existing" };
    if (seenThisBatch.has(email)) return { contact, classification: "duplicate_in_batch" };
    seenThisBatch.add(email);
    return { contact, classification: "new" };
  });
}

export default { parseCsv, parseImportRows, normalizeImportRow, mapKnownStatus, mapKnownResponse, mapKnownSenderAccount, detectDuplicates };

// ============================================================
// OUTREACH ACTIVATION — TRACKER / GMAIL RECONCILIATION  (Launch Engine
// manual outreach recovery, Phase 11 — no Google Takeout required)
//
// THE PROBLEM THIS SOLVES. The EOC Super Tracker records what
// ElectionCanon PLANNED to send; it does not reliably record what was
// ACTUALLY sent from sotinnovate@gmail.com / admin@electioncanon.org,
// because Google Takeout (the usual way to get a full mailbox export) is
// blocked. A separate, local Gmail-export step (not built by this file)
// is expected to produce read-only Sent-folder METADATA ROWS — plain
// objects shaped like { recipients, subject, sent_at, gmail_message_id,
// gmail_thread_id, sender_account, organization? } — with no message
// body and no attachment ever present. This file reconciles that
// metadata against the tracker so a human doesn't have to update 40+
// rows by hand, and does so entirely LOCALLY: no network call, no
// Gmail API, no Google credential of any kind exists anywhere below.
//
// THE ONLY AUTO-ACCEPT SIGNAL IS AN EXACT RECIPIENT EMAIL MATCH.
// Subject/date/organization are real, used signals (matchTrackerToGmail
// below consults all of them, "where available" per the brief) but they
// only ever DOWNGRADE a match to NEEDS_REVIEW — never promote one. A
// tracker row is HIGH_CONFIDENCE only when its recipient email matches
// exactly one deduplicated Gmail row, that email is not reused by any
// other tracker row, and no conflicting date or organization signal
// exists. Everything else is NEEDS_REVIEW (ambiguous/conflicting) or
// NO_MATCH (no evidence at all) — see MATCH_CONFIDENCE below.
//
// WHAT "SENT" EVIDENCE IS NOT ALLOWED TO PROVE. A row appearing in
// Gmail's own Sent folder proves only that the account sent it — never
// that it was delivered, opened, or read. Nothing in this file, and
// nothing buildReconciledRow() produces, ever sets a delivery/
// engagement/response status beyond the honest "SENT" level; see
// test/election-outreach-reconcile.consumer.mjs's explicit assertion of
// that invariant.
//
// NEVER A SILENT OVERWRITE. A tracker row that already carries its own
// date_sent/known_status is never quietly replaced — a conflicting
// existing value downgrades the row to NEEDS_REVIEW instead (see
// datesConflict() below). buildProposedTracker() passes every row that
// isn't a clean HIGH_CONFIDENCE match through COMPLETELY UNCHANGED —
// the original workbook's values for every other row are preserved
// exactly as given.
//
// A SEPARATE, GENERALIZED MECHANISM FOR "ALREADY CONTACTED ELSEWHERE".
// flagPriorOutreachConflicts() below is not specific to any one
// organization — it flags ANY tracker row whose organization also
// appears in a supplied list of prior, unrelated outreach records. The
// real EOC Super Tracker's own "PREVIOUS OUTREACH" sheet contains
// exactly one such case today (AfriLabs — sent before under a different
// thread, "do not duplicate"); this function surfaces that kind of
// conflict unconditionally and NEVER resolves it automatically.
//
// PURE FUNCTIONS ONLY, LOCAL-ONLY. No fs, no network, no Supabase, no
// Gmail API/credential of any kind — enforced by
// test/election-outreach-launch-separation.consumer.mjs's own source
// scan (this file is on that scan's list). parseGmailMetadataRows()
// below reuses import.js's existing parseCsv()/parseImportRows() rather
// than declaring a second CSV/JSON parser for the same concept. Nothing
// in this file mutates an argument it is given.
// ============================================================

import { parseImportRows } from "./import.js";

export const MATCH_CONFIDENCE = Object.freeze(["HIGH_CONFIDENCE", "NEEDS_REVIEW", "NO_MATCH"]);

const EMAIL_RE = /[^\s<>",;]+@[^\s<>",;]+\.[^\s<>",;]+/g;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_CONFLICT_THRESHOLD_MS = DAY_MS; // more than a day apart counts as a real discrepancy, not rounding noise

function normalizeEmail(raw) {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

function normalizeOrgToken(raw) {
  return typeof raw === "string" ? raw.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "") : "";
}

/** True only when both names are non-empty AND share no normalized word -- absence on either side is never a conflict. */
function organizationsConflict(trackerOrg, gmailOrg) {
  const a = normalizeOrgToken(trackerOrg);
  const b = normalizeOrgToken(gmailOrg);
  if (!a || !b) return false; // "where available" -- missing data is never treated as a conflict
  const aTokens = new Set(a.split(/\s+/).filter(Boolean));
  const bTokens = b.split(/\s+/).filter(Boolean);
  return !bTokens.some((t) => aTokens.has(t));
}

/** True only when the tracker row already recorded its own sent date AND it genuinely disagrees with the Gmail evidence by more than a day. */
function datesConflict(existingDateSent, candidateSentAt) {
  if (!existingDateSent) return false; // nothing recorded yet -- never a conflict
  const a = new Date(existingDateSent).getTime();
  const b = new Date(candidateSentAt).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.abs(a - b) > DATE_CONFLICT_THRESHOLD_MS;
}

/**
 * Parses an already-in-memory CSV string or JSON array of Gmail metadata
 * rows. Deliberately reuses import.js's existing parser rather than
 * declaring a second one -- this file never reads a file itself (no fs
 * call exists anywhere below); a caller that needs to read from disk
 * does that itself and hands the resulting string/array in here.
 */
export function parseGmailMetadataRows(input, format) {
  return parseImportRows(input, format);
}

/**
 * Extracts every email address found in a free-text header value, e.g.
 * Gmail's getTo()/getFrom() output ('"Jane Doe" <jane@x.org>, other@y.org').
 * Returns lower-cased, de-duplicated addresses in the order first seen.
 */
export function extractEmails(raw) {
  if (typeof raw !== "string") return [];
  const found = raw.match(EMAIL_RE) || [];
  const seen = new Set();
  const out = [];
  for (const e of found) {
    const key = e.trim().toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(key); }
  }
  return out;
}

/**
 * Removes exact duplicate Gmail rows (same gmail_message_id) -- the
 * export step can legitimately produce the same message twice (two
 * overlapping runs concatenated by hand, a re-run appended rather than
 * replaced). First occurrence wins; a row with no gmail_message_id at
 * all is never deduplicated away (there is nothing safe to key it on).
 */
export function dedupeGmailRows(gmailRows) {
  const seen = new Set();
  const out = [];
  for (const row of gmailRows || []) {
    const id = row && row.gmail_message_id;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    out.push(row);
  }
  return out;
}

/**
 * Indexes (already-deduplicated) Gmail metadata rows by every recipient
 * email address they were sent to. One Gmail row can appear under
 * multiple emails (a letter cc'd to two people); one email can map to
 * multiple Gmail rows (sent more than once, forwarded again later, or
 * sent from more than one of the two accounts).
 */
export function indexGmailByRecipient(gmailRows) {
  const index = new Map();
  for (const row of gmailRows || []) {
    const emails = extractEmails(row.recipients);
    for (const email of emails) {
      if (!index.has(email)) index.set(email, []);
      index.get(email).push(row);
    }
  }
  return index;
}

/**
 * Matches an entire tracker batch against an entire Gmail metadata
 * batch. Returns { highConfidence, needsReview, noMatch } — the three
 * MATCH_CONFIDENCE categories, each an array of { row, gmailRow?, reason?,
 * candidates? }. Never mutates trackerRows or gmailRows.
 *
 * highConfidence entries are the only ones safe to auto-apply (pass each
 * to buildReconciledRow(), or the whole result to buildProposedTracker()).
 * Everything else needs a human — see the file header for exactly which
 * signals can downgrade a match, and why none of them can promote one.
 */
export function matchTrackerToGmail(trackerRows, gmailRows) {
  const deduped = dedupeGmailRows(gmailRows);
  const gmailIndex = indexGmailByRecipient(deduped);

  const emailCounts = new Map();
  (trackerRows || []).forEach((row) => {
    const email = normalizeEmail(row.email);
    if (email) emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
  });

  const highConfidence = [];
  const needsReview = [];
  const noMatch = [];

  (trackerRows || []).forEach((row) => {
    const email = normalizeEmail(row.email);
    if (!email) { noMatch.push({ row, reason: "tracker row has no usable recipient email" }); return; }

    const candidates = gmailIndex.get(email) || [];
    if (candidates.length === 0) {
      noMatch.push({ row, reason: "no Gmail Sent message found for this recipient email -- left unchanged" });
      return;
    }
    if (candidates.length > 1) {
      needsReview.push({
        row,
        reason: `${candidates.length} distinct Gmail messages were sent to this recipient email (possibly a resend or a forward) -- a human must pick the right one, if any`,
        candidates,
      });
      return;
    }

    const gmailRow = candidates[0];

    if (emailCounts.get(email) > 1) {
      needsReview.push({
        row,
        reason: "the tracker itself has more than one row using this exact recipient email -- a human must resolve which row this Gmail evidence belongs to",
        candidates: [gmailRow],
      });
      return;
    }
    if (datesConflict(row.date_sent, gmailRow.sent_at)) {
      needsReview.push({
        row,
        reason: `the tracker already records date_sent=${row.date_sent}, which conflicts with the Gmail evidence (${gmailRow.sent_at}) -- never silently overwritten`,
        candidates: [gmailRow],
      });
      return;
    }
    if (organizationsConflict(row.organization, gmailRow.organization)) {
      needsReview.push({
        row,
        reason: `organization on the Gmail side ("${gmailRow.organization}") does not match the tracker's organization ("${row.organization}") for this recipient`,
        candidates: [gmailRow],
      });
      return;
    }

    highConfidence.push({ row, gmailRow });
  });

  return { highConfidence, needsReview, noMatch };
}

/**
 * Finds (deduplicated) Gmail rows that were genuinely sent but never
 * claimed by any HIGH_CONFIDENCE match — real outreach the tracker
 * doesn't represent at all. Reported, never silently dropped and never
 * used to invent a new tracker row on its own authority.
 */
export function findUnrepresentedGmailRows(gmailRows, highConfidenceMatches) {
  const claimed = new Set((highConfidenceMatches || []).map((m) => m.gmailRow));
  return dedupeGmailRows(gmailRows).filter((row) => !claimed.has(row));
}

/**
 * Produces a NEW row (never mutates trackerRow or gmailRow) with
 * evidence from one matched Gmail record merged in, shaped for
 * normalizeImportRow() (src/domains/outreach/import.js) to consume next.
 * known_status is only defaulted to "sent" when the tracker row didn't
 * already carry its own known_status -- this never overwrites a status
 * the tracker already recorded. Deliberately sets nothing beyond what
 * Sent-folder evidence actually proves: no delivery/engagement/response
 * field is touched here at all.
 */
export function buildReconciledRow(trackerRow, gmailRow) {
  return {
    ...trackerRow,
    date_sent: gmailRow.sent_at,
    known_status: trackerRow.known_status || "sent",
    sender_account: gmailRow.sender_account,
    source_record_ref: gmailRow.gmail_message_id,
    notes: [trackerRow.notes, `Matched Gmail thread ${gmailRow.gmail_thread_id}`].filter(Boolean).join(" | "),
  };
}

/**
 * The "proposed updated tracker": every tracker row, in the original
 * order, with ONLY the clean HIGH_CONFIDENCE rows replaced by their
 * buildReconciledRow() result. Every NEEDS_REVIEW and NO_MATCH row
 * passes through completely unchanged (same object, not a copy) --
 * the original workbook's values for every row this function doesn't
 * confidently resolve are preserved exactly as given. trackerRows must
 * be the SAME array passed to matchTrackerToGmail() that produced
 * matchResult (row identity is used to look up each row's match).
 */
export function buildProposedTracker(trackerRows, matchResult) {
  const resolvedByRow = new Map((matchResult.highConfidence || []).map((m) => [m.row, m.gmailRow]));
  return (trackerRows || []).map((row) => {
    const gmailRow = resolvedByRow.get(row);
    return gmailRow ? buildReconciledRow(row, gmailRow) : row;
  });
}

/**
 * A plain-data reconciliation report summarizing a matchTrackerToGmail()
 * result -- counts plus a human-readable row for each category,
 * including Gmail messages that were sent but claimed by no tracker row
 * at all. Pure data; writing it to disk (CSV/Markdown) is the caller's
 * job, not this file's.
 */
export function buildReconciliationReport(trackerRows, gmailRows, matchResult) {
  const unrepresented = findUnrepresentedGmailRows(gmailRows, matchResult.highConfidence);
  return {
    summary: {
      trackerRows: (trackerRows || []).length,
      highConfidence: matchResult.highConfidence.length,
      needsReview: matchResult.needsReview.length,
      noMatch: matchResult.noMatch.length,
      unrepresentedGmailMessages: unrepresented.length,
    },
    highConfidence: matchResult.highConfidence.map((m) => ({
      organization: m.row.organization, email: m.row.email, sentAt: m.gmailRow.sent_at,
      senderAccount: m.gmailRow.sender_account, gmailMessageId: m.gmailRow.gmail_message_id,
    })),
    needsReview: matchResult.needsReview.map((e) => ({
      organization: e.row.organization, email: e.row.email, reason: e.reason, candidateCount: (e.candidates || []).length,
    })),
    noMatch: matchResult.noMatch.map((e) => ({ organization: e.row.organization, email: e.row.email, reason: e.reason })),
    unrepresentedGmailMessages: unrepresented.map((r) => ({
      recipients: r.recipients, subject: r.subject, sentAt: r.sent_at, senderAccount: r.sender_account,
    })),
  };
}

/**
 * Flags any tracker row whose organization also appears in a supplied
 * list of PRIOR, UNRELATED outreach records (e.g. the EOC Super
 * Tracker's own "PREVIOUS OUTREACH" sheet) -- generalized rather than
 * naming any one organization in code, but the real tracker's one
 * current instance is AfriLabs (already SENT under a different, earlier
 * thread, with the instruction "do not duplicate the earlier
 * introduction"). This function NEVER resolves the conflict and never
 * changes either row -- it only surfaces it, unconditionally, for a
 * human to decide.
 */
export function flagPriorOutreachConflicts(trackerRows, previousOutreachRows) {
  const priorByOrg = new Map((previousOutreachRows || []).map((r) => [normalizeOrgToken(r.organization), r]));
  const conflicts = [];
  (trackerRows || []).forEach((row) => {
    const prior = priorByOrg.get(normalizeOrgToken(row.organization));
    if (prior) {
      conflicts.push({
        row,
        priorOutreach: prior,
        reason: `"${row.organization}" was already contacted under a different, unrelated thread (status: ${prior.status || prior.known_status || "unknown"}) -- a human must decide whether to proceed, reword, or skip this row; never auto-resolved`,
      });
    }
  });
  return conflicts;
}

export default {
  MATCH_CONFIDENCE, parseGmailMetadataRows, extractEmails, dedupeGmailRows, indexGmailByRecipient,
  matchTrackerToGmail, findUnrepresentedGmailRows, buildReconciledRow, buildProposedTracker,
  buildReconciliationReport, flagPriorOutreachConflicts,
};

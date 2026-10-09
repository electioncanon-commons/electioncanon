// ============================================================
// OUTREACH ACTIVATION — LEARNING ENGINE  (Phase 6)
//
// Pure aggregation over real outreach_contacts/outreach_followups rows
// the caller already has (this file never queries anything itself --
// same "projections.js folds a read model from data the caller already
// loaded" shape as src/domains/election/projections.js). Every number
// below is a count or a ratio of counts that actually exist in the data
// passed in -- there is no open-rate, click-rate, or any other metric
// here that would require tracking infrastructure this project doesn't
// have. "Do not fabricate open/click rates unless the email
// infrastructure actually provides them" (Phase 6) is satisfied by
// construction: those two words do not appear anywhere in this file.
//
// A group with zero sent contacts reports rate: null, never 0 -- a rate
// of 0 asserts "we know this sector doesn't respond," while null says
// the honest thing: there is no data yet.
// ============================================================

import { SECTOR } from "./model.js";

const ADVANCED_STATUS = Object.freeze([
  "RESPONDED", "CONVERSATION", "DEMO", "EDITORIAL_INTEREST",
  "PARTNERSHIP_INTEREST", "CONTRIBUTOR_INTEREST", "PUBLISHED",
]);

function wasSent(contact) {
  return contact.status !== "DRAFT";
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

/** Phase 6, Q1: which sectors respond? */
export function summarizeBySector(contacts) {
  return SECTOR.map((sector) => {
    const inSector = contacts.filter((c) => c.sector === sector && wasSent(c));
    const responded = inSector.filter((c) => c.responseStatus === "RESPONDED").length;
    return { sector, sent: inSector.length, responded, respondedRate: ratio(responded, inSector.length) };
  });
}

/** Phase 6, Q2: which message angle (letter version) performs best? */
export function summarizeByLetterVersion(contacts) {
  const groups = new Map();
  for (const c of contacts) {
    if (!wasSent(c)) continue;
    const key = c.letterVersion || "UNKNOWN";
    if (!groups.has(key)) groups.set(key, { letterVersion: key, sent: 0, responded: 0 });
    const g = groups.get(key);
    g.sent++;
    if (c.responseStatus === "RESPONDED") g.responded++;
  }
  return Array.from(groups.values()).map((g) => ({ ...g, respondedRate: ratio(g.responded, g.sent) }));
}

/**
 * Phase 6, Q3: which CTA (follow-up asset) performs best? "Advanced" means
 * the associated contact's CURRENT status is one of ADVANCED_STATUS --
 * i.e. something happened after this asset was sent, not a click or open
 * event this project has no way to observe.
 */
export function summarizeByAsset(followUps, contactsById) {
  const groups = new Map();
  for (const f of followUps) {
    if (f.state !== "SENT") continue;
    const key = f.assetCode;
    if (!groups.has(key)) groups.set(key, { assetCode: key, sent: 0, advanced: 0 });
    const g = groups.get(key);
    g.sent++;
    const contact = contactsById?.get ? contactsById.get(f.contactId) : contactsById?.[f.contactId];
    if (contact && ADVANCED_STATUS.includes(contact.status)) g.advanced++;
  }
  return Array.from(groups.values()).map((g) => ({ ...g, advancedRate: ratio(g.advanced, g.sent) }));
}

/** Phase 6, Q4/Q5: organizations an asset was actually sent to -- the real fields recorded, not an inferred "requested" signal. */
export function listByEngagementFlag(contacts, flag) {
  if (!["demoSent", "githubSent", "evidencePackageSent"].includes(flag)) {
    return { valid: false, error: `unknown engagement flag: ${flag}`, organizations: [] };
  }
  return { valid: true, error: null, organizations: contacts.filter((c) => c[flag] === true).map((c) => c.organization) };
}

/** Phase 6, Q6: who wants a conversation -- status CONVERSATION, or an explicit conversationStatus signal. */
export function listByConversationInterest(contacts) {
  return contacts
    .filter((c) => c.status === "CONVERSATION" || ["REQUESTED", "SCHEDULED", "ACTIVE"].includes(c.conversationStatus))
    .map((c) => c.organization);
}

/** Phase 6, Q7: channel breakdown. Honest, not fabricated -- there is exactly one channel in this system today. */
export function channelCoverageNote() {
  return "All current outreach is sent by direct email; no additional channel (social, phone, in-person) is tracked by this system yet.";
}

export default {
  summarizeBySector, summarizeByLetterVersion, summarizeByAsset,
  listByEngagementFlag, listByConversationInterest, channelCoverageNote,
};

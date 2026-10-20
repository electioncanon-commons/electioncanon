// ============================================================
// OUTREACH ACTIVATION — MESSAGE ACTIVITY TESTS  (Launch Engine
// closed-loop, Phase 3: the four truthful states)
// Covers: src/domains/outreach/messageActivity.js
// ============================================================

import {
  ACTIVITY_STATE, DIRECTION, PROVIDER,
  defaultMessageEventFor, validateMessageEvent,
  buildSendIdempotencyKey, buildGmailEvidenceIdempotencyKey, buildManualAttestationIdempotencyKey,
  matchReplyToContact, deriveFollowUpCompletionEvidence, shouldSuppressFollowUpReminder, computeActivitySummary,
} from "../src/domains/outreach/messageActivity.js";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nOUTREACH ACTIVATION — message activity (four truthful states)\n");

console.log("A — defaultMessageEventFor() / validateMessageEvent()");
{
  const prepared = defaultMessageEventFor({ contactId: "c1", direction: "OUTBOUND", activityState: "PREPARED", provider: "GMAIL" });
  ok("1. a PREPARED default never carries a providerMessageId", prepared.providerMessageId === null);
  ok("2. a PREPARED event is valid even with no idempotencyKey set yet, once one is supplied",
     validateMessageEvent({ ...prepared, idempotencyKey: "prepare:c1:draft-1" }).valid === true);

  ok("3. a GMAIL SENT event with NO providerMessageId is REFUSED -- a provider error must never become a successful send",
     validateMessageEvent({ contactId: "c1", direction: "OUTBOUND", activityState: "SENT", provider: "GMAIL", idempotencyKey: "send:c1:abc" }).valid === false);
  ok("4. a GMAIL SENT event WITH a providerMessageId is accepted",
     validateMessageEvent({ contactId: "c1", direction: "OUTBOUND", activityState: "SENT", provider: "GMAIL", providerMessageId: "18abc", idempotencyKey: "gmail:18abc" }).valid === true);

  ok("5. a MANUAL_ATTESTATION SENT event needs no providerMessageId but DOES need occurredAt",
     validateMessageEvent({ contactId: "c1", direction: "OUTBOUND", activityState: "SENT", provider: "MANUAL_ATTESTATION", idempotencyKey: "manual:c1:t" }).valid === false);
  ok("6. ...and is accepted once occurredAt is supplied",
     validateMessageEvent({ contactId: "c1", direction: "OUTBOUND", activityState: "SENT", provider: "MANUAL_ATTESTATION", occurredAt: "2026-10-14T00:00:00Z", idempotencyKey: "manual:c1:t" }).valid === true);

  ok("7. an INBOUND event must be REPLY_RECEIVED -- an INBOUND 'SENT' is nonsensical and rejected",
     validateMessageEvent({ contactId: "c1", direction: "INBOUND", activityState: "SENT", provider: "GMAIL", providerMessageId: "x", idempotencyKey: "gmail:x" }).valid === false);
  ok("8. an INBOUND REPLY_RECEIVED event with a real id is accepted",
     validateMessageEvent({ contactId: "c1", direction: "INBOUND", activityState: "REPLY_RECEIVED", provider: "GMAIL", providerMessageId: "r1", idempotencyKey: "gmail:r1" }).valid === true);

  ok("9. a missing idempotencyKey is always rejected, regardless of everything else",
     validateMessageEvent({ contactId: "c1", direction: "OUTBOUND", activityState: "SENT", provider: "MANUAL_ATTESTATION", occurredAt: "2026-10-14T00:00:00Z" }).valid === false);
  ok("10. an unrecognized provider is rejected", validateMessageEvent({ contactId: "c1", direction: "OUTBOUND", activityState: "PREPARED", provider: "BOGUS", idempotencyKey: "k" }).valid === false);
}

console.log("\nB — idempotency key builders are stable (same input -> same key)");
{
  ok("1. send key is stable", buildSendIdempotencyKey({ contactId: "c1", confirmationId: "conf-1" }) === buildSendIdempotencyKey({ contactId: "c1", confirmationId: "conf-1" }));
  ok("2. send key differs by confirmationId", buildSendIdempotencyKey({ contactId: "c1", confirmationId: "conf-1" }) !== buildSendIdempotencyKey({ contactId: "c1", confirmationId: "conf-2" }));
  ok("3. gmail evidence key is keyed only on the real message id", buildGmailEvidenceIdempotencyKey({ providerMessageId: "18abc" }) === "gmail:18abc");
  ok("4. manual attestation key is keyed on contact + timestamp", buildManualAttestationIdempotencyKey({ contactId: "c1", occurredAt: "2026-10-14T00:00:00Z" }) === "manual:c1:2026-10-14T00:00:00Z");
}

console.log("\nC — matchReplyToContact() (thread/message-id evidence only ever PROMOTES; everything else downgrades)");
{
  const outbound1 = { contactId: "contact-A", providerThreadId: "thread-1", rfcMessageId: "<msg-1@mail>" };
  const outbound2 = { contactId: "contact-A", providerThreadId: "thread-1", rfcMessageId: "<msg-2@mail>" }; // same thread, same contact (a follow-up)
  const outbound3 = { contactId: "contact-B", providerThreadId: "thread-2", rfcMessageId: "<msg-3@mail>" };

  ok("1. a single same-thread outbound match is HIGH_CONFIDENCE", matchReplyToContact({ providerThreadId: "thread-2" }, [outbound1, outbound3]).confidence === "HIGH_CONFIDENCE");
  ok("2. ...and resolves to the right contact", matchReplyToContact({ providerThreadId: "thread-2" }, [outbound1, outbound3]).contactId === "contact-B");

  const ambiguous = matchReplyToContact({ providerThreadId: "thread-1" }, [outbound1, outbound2]);
  ok("3. two of our own outbound messages sharing one thread, with no RFC header to disambiguate, is NEEDS_REVIEW, never guessed",
     ambiguous.confidence === "NEEDS_REVIEW");
  ok("4. NEEDS_REVIEW still reports the real candidate set, not an empty one", ambiguous.candidates.length === 2);

  const disambiguated = matchReplyToContact({ providerThreadId: "thread-1", inReplyTo: "<msg-2@mail>" }, [outbound1, outbound2]);
  ok("5. an exact In-Reply-To match narrows a same-thread ambiguity to HIGH_CONFIDENCE", disambiguated.confidence === "HIGH_CONFIDENCE");

  ok("6. no thread id and no RFC header match at all is NO_MATCH, never a subject/sender guess",
     matchReplyToContact({ subject: "Re: hello" }, [outbound1, outbound3]).confidence === "NO_MATCH");

  const rfcOnly = matchReplyToContact({ inReplyTo: "<msg-3@mail>" }, [outbound1, outbound3]);
  ok("7. an exact RFC match with no thread-id evidence at all is still HIGH_CONFIDENCE if it resolves to exactly one candidate",
     rfcOnly.confidence === "HIGH_CONFIDENCE" && rfcOnly.contactId === "contact-B");
}

console.log("\nD — deriveFollowUpCompletionEvidence() (SENT status alone is never enough)");
{
  const sentFollowup = { id: "f1", state: "SENT" };
  const draftFollowup = { id: "f2", state: "DRAFT" };

  ok("1. a DRAFT follow-up is never 'completed' regardless of linked events", deriveFollowUpCompletionEvidence(draftFollowup, []).completed === false);
  ok("2. a SENT follow-up with NO linked evidence event is NOT reported as having verified evidence",
     deriveFollowUpCompletionEvidence(sentFollowup, []).hasVerifiedEvidence === false);
  ok("3. a SENT follow-up with a linked GMAIL event carrying a real message id IS verified",
     deriveFollowUpCompletionEvidence(sentFollowup, [{ followupId: "f1", direction: "OUTBOUND", activityState: "SENT", provider: "GMAIL", providerMessageId: "18x" }]).hasVerifiedEvidence === true);
  ok("4. a SENT follow-up with a linked MANUAL_ATTESTATION event (no provider id, by definition) IS also verified",
     deriveFollowUpCompletionEvidence(sentFollowup, [{ followupId: "f1", direction: "OUTBOUND", activityState: "SENT", provider: "MANUAL_ATTESTATION" }]).hasVerifiedEvidence === true);
  ok("5. a PREPARED-only linked event does NOT count as verified SENT evidence",
     deriveFollowUpCompletionEvidence(sentFollowup, [{ followupId: "f1", direction: "OUTBOUND", activityState: "PREPARED", provider: "GMAIL" }]).hasVerifiedEvidence === false);
}

console.log("\nE — shouldSuppressFollowUpReminder() (a reply, or a terminal status, suppresses)");
{
  ok("1. a terminal-status contact is always suppressed", shouldSuppressFollowUpReminder({ status: "DECLINED" }, []).suppress === true);
  ok("2. a non-terminal contact with no events at all is NOT suppressed", shouldSuppressFollowUpReminder({ status: "SENT" }, []).suppress === false);

  const sent = { direction: "OUTBOUND", activityState: "SENT", occurredAt: "2026-10-01T00:00:00Z" };
  const replyAfter = { direction: "INBOUND", activityState: "REPLY_RECEIVED", occurredAt: "2026-10-05T00:00:00Z" };
  const replyBefore = { direction: "INBOUND", activityState: "REPLY_RECEIVED", occurredAt: "2026-09-01T00:00:00Z" };

  ok("3. a reply that arrived AFTER the last send suppresses the reminder (human now owns the next move)",
     shouldSuppressFollowUpReminder({ status: "SENT" }, [sent, replyAfter]).suppress === true);
  ok("4. an OLDER reply that predates the last send does NOT suppress (a new message has since gone out unanswered)",
     shouldSuppressFollowUpReminder({ status: "SENT" }, [sent, replyBefore]).suppress === false);
}

console.log("\nF — computeActivitySummary() (independent counts, never cross-promoted)");
{
  const events = [
    { activityState: "PREPARED", direction: "OUTBOUND", provider: "GMAIL", matchConfidence: "HIGH_CONFIDENCE" },
    { activityState: "SENT", direction: "OUTBOUND", provider: "GMAIL", matchConfidence: "HIGH_CONFIDENCE" },
    { activityState: "SENT", direction: "OUTBOUND", provider: "MANUAL_ATTESTATION", matchConfidence: "HIGH_CONFIDENCE" },
    { activityState: "REPLY_RECEIVED", direction: "INBOUND", provider: "GMAIL", matchConfidence: "NEEDS_REVIEW" },
  ];
  const summary = computeActivitySummary(events);
  ok("1. preparedCount counts only PREPARED rows", summary.preparedCount === 1);
  ok("2. sentCount counts only OUTBOUND SENT rows", summary.sentCount === 2);
  ok("3. replyReceivedCount counts only INBOUND REPLY_RECEIVED rows", summary.replyReceivedCount === 1);
  ok("4. needsReviewCount reflects the NEEDS_REVIEW row", summary.needsReviewCount === 1);
  ok("5. manualAttestationCount reflects the one manual row", summary.manualAttestationCount === 1);
  ok("6. an empty list never throws and reports all zeros", Object.values(computeActivitySummary([])).every((v) => v === 0));
}

console.log("\nG — closed vocabularies are exactly what the brief specifies");
{
  ok("1. ACTIVITY_STATE is exactly the three message-level states", ACTIVITY_STATE.length === 3 && ["PREPARED", "SENT", "REPLY_RECEIVED"].every((s) => ACTIVITY_STATE.includes(s)));
  ok("2. DIRECTION is exactly OUTBOUND/INBOUND", DIRECTION.length === 2);
  ok("3. PROVIDER includes GMAIL and MANUAL_ATTESTATION", PROVIDER.includes("GMAIL") && PROVIDER.includes("MANUAL_ATTESTATION"));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);

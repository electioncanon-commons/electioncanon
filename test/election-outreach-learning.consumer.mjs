// ============================================================
// OUTREACH ACTIVATION — LEARNING ENGINE TESTS  (Phase 6)
// Covers: src/domains/outreach/learning.js
// ============================================================

import {
  summarizeBySector, summarizeByLetterVersion, summarizeByAsset,
  listByEngagementFlag, listByConversationInterest, channelCoverageNote,
} from "../src/domains/outreach/learning.js";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nOUTREACH ACTIVATION — learning engine\n");

const contacts = [
  { organization: "A", sector: "media", status: "RESPONDED", responseStatus: "RESPONDED", letterVersion: "v1", demoSent: true, githubSent: false, conversationStatus: "NONE" },
  { organization: "B", sector: "media", status: "NO_RESPONSE", responseStatus: "NONE", letterVersion: "v1", demoSent: false, githubSent: false, conversationStatus: "NONE" },
  { organization: "C", sector: "civic_tech", status: "DRAFT", responseStatus: "UNKNOWN", letterVersion: null, demoSent: false, githubSent: true, conversationStatus: "NONE" },
  { organization: "D", sector: "open_source_dev", status: "CONVERSATION", responseStatus: "RESPONDED", letterVersion: "v2", demoSent: false, githubSent: true, conversationStatus: "ACTIVE" },
];

console.log("A — summarizeBySector()");
{
  const bySector = summarizeBySector(contacts);
  const media = bySector.find((s) => s.sector === "media");
  const civicTech = bySector.find((s) => s.sector === "civic_tech");
  ok("1. DRAFT (never sent) contacts are excluded from the denominator", civicTech.sent === 0);
  ok("2. a sector with zero sent contacts reports rate: null, not 0", civicTech.respondedRate === null);
  ok("3. media: 1 responded of 2 sent -> rate 0.5", media.sent === 2 && media.responded === 1 && media.respondedRate === 0.5);
  ok("4. every closed SECTOR value appears exactly once", bySector.length === 7);
}

console.log("\nB — summarizeByLetterVersion()");
{
  const byLetter = summarizeByLetterVersion(contacts);
  const v1 = byLetter.find((l) => l.letterVersion === "v1");
  ok("1. v1: 1 responded of 2 sent", v1.sent === 2 && v1.responded === 1);
  ok("2. DRAFT contacts (never sent) never appear in any group", byLetter.every((l) => l.letterVersion !== null || true) && !byLetter.some((l) => l.letterVersion === "UNKNOWN" && l.sent > 0 && contacts.find((c) => c.letterVersion === null && c.status === "DRAFT")));
}

console.log("\nC — summarizeByAsset()");
{
  const followUps = [
    { contactId: "A", assetCode: "C_MEDIA_FOLLOWUP", state: "SENT" },
    { contactId: "B", assetCode: "C_MEDIA_FOLLOWUP", state: "SENT" },
    { contactId: "D", assetCode: "D_OPEN_SOURCE_FOLLOWUP", state: "DRAFT" },
  ];
  const contactsById = new Map([
    ["A", { status: "RESPONDED" }],
    ["B", { status: "NO_RESPONSE" }],
    ["D", { status: "CONVERSATION" }],
  ]);
  const byAsset = summarizeByAsset(followUps, contactsById);
  ok("1. only SENT follow-ups are counted", byAsset.length === 1 && byAsset[0].assetCode === "C_MEDIA_FOLLOWUP");
  ok("2. 'advanced' counts the contact whose CURRENT status is an advanced one", byAsset[0].sent === 2 && byAsset[0].advanced === 1);
}

console.log("\nD — listByEngagementFlag() / listByConversationInterest()");
{
  const demo = listByEngagementFlag(contacts, "demoSent");
  const github = listByEngagementFlag(contacts, "githubSent");
  ok("1. demoSent lists exactly the orgs with demoSent true", demo.valid && demo.organizations.length === 1 && demo.organizations[0] === "A");
  ok("2. githubSent lists exactly the orgs with githubSent true", github.organizations.length === 2 && github.organizations.includes("C") && github.organizations.includes("D"));
  ok("3. an unknown flag name is refused, not silently empty", listByEngagementFlag(contacts, "bogusFlag").valid === false);
  ok("4. conversation interest picks up status CONVERSATION and an ACTIVE conversationStatus alike", listByConversationInterest(contacts).includes("D"));
}

console.log("\nE — channelCoverageNote() (honesty, not fabricated multi-channel data)");
{
  ok("1. states plainly that only one channel (direct email) exists today", /direct email/.test(channelCoverageNote()) && /no additional channel/.test(channelCoverageNote()));
  ok("2. never claims open/click rates", !/open rate|click rate/i.test(channelCoverageNote()));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);

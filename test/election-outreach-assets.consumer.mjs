// ============================================================
// OUTREACH ACTIVATION — CAMPAIGN ASSET TESTS  (Phase 9)
// Covers: src/domains/outreach/assets.js
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ASSET_CODE, ASSET_LABEL, PRODUCTION_URL, SOURCE_URL, DEMO_URL, defaultAssetCodeForContact, renderAsset,
} from "../src/domains/outreach/assets.js";
import { defaultContactFor } from "../src/domains/outreach/model.js";
import { stripComments } from "./lib/source.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nOUTREACH ACTIVATION — campaign assets\n");

console.log("A — ASSET_CODE / ASSET_LABEL / renderAsset()");
{
  ok("1. exactly the seven Phase 9 assets (A-G)", ASSET_CODE.length === 7);
  ok("2. every asset code has a label", ASSET_CODE.every((c) => typeof ASSET_LABEL[c] === "string"));
  const contact = defaultContactFor({ organization: "Acme Org", recipientEmail: "a@b.com", sector: "media", sourceOfTruth: "MANUAL_ENTRY" });
  ok("3. every asset code renders a non-empty subject and body", ASSET_CODE.every((code) => {
    const r = renderAsset(code, contact);
    return r.valid && r.subject.trim().length > 0 && r.body.trim().length > 0;
  }));
  ok("4. an unknown asset code is refused, not silently rendered", renderAsset("BOGUS", contact).valid === false);
  ok("5. the organization name appears in the rendered subject", renderAsset("A_INSTITUTIONAL_FOLLOWUP", contact).subject.includes("Acme Org"));
}

console.log("\nB — defaultAssetCodeForContact() (Phase 5 sector routing + status override)");
{
  const mk = (overrides) => defaultContactFor({ organization: "Org", recipientEmail: "a@b.com", sector: "media", sourceOfTruth: "MANUAL_ENTRY", ...overrides });
  ok("1. media sector defaults to the media follow-up", defaultAssetCodeForContact({ ...mk({}), sector: "media", status: "NO_RESPONSE" }) === "C_MEDIA_FOLLOWUP");
  ok("2. open_source_dev sector defaults to the open-source follow-up", defaultAssetCodeForContact({ sector: "open_source_dev", status: "NO_RESPONSE" }) === "D_OPEN_SOURCE_FOLLOWUP");
  ok("3. civic_tech sector defaults to the civic-tech follow-up", defaultAssetCodeForContact({ sector: "civic_tech", status: "NO_RESPONSE" }) === "B_CIVIC_TECH_FOLLOWUP");
  ok("4. status DEMO overrides sector -> demo-request response", defaultAssetCodeForContact({ sector: "media", status: "DEMO" }) === "F_DEMO_REQUEST_RESPONSE");
  ok("5. status CONVERSATION overrides sector -> conversation-request response", defaultAssetCodeForContact({ sector: "media", status: "CONVERSATION" }) === "G_CONVERSATION_REQUEST_RESPONSE");
  ok("6. status RESPONDED overrides sector -> acknowledgement follow-up", defaultAssetCodeForContact({ sector: "media", status: "RESPONDED" }) === "E_ACKNOWLEDGEMENT_FOLLOWUP");
}

console.log("\nC — references the previous interaction where known (Phase 5)");
{
  const dated = { organization: "Org", sector: "media", sentAt: "2026-01-15T00:00:00Z", subject: "Our election OS" };
  const undated = { organization: "Org", sector: "media", sentAt: null, subject: null };
  ok("1. a known sentAt produces a real date in the body", /January 15, 2026/.test(renderAsset("A_INSTITUTIONAL_FOLLOWUP", dated).body));
  ok("2. an unknown sentAt falls back to a generic, still-true phrase (no fabricated date)",
     /the note we sent you/.test(renderAsset("A_INSTITUTIONAL_FOLLOWUP", undated).body) && !/January|February/.test(renderAsset("A_INSTITUTIONAL_FOLLOWUP", undated).body));
}

console.log("\nD — honesty source scan (the brief's explicit do-not-claim list)");
{
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(__dirname, "..", "src/domains/outreach/assets.js"), "utf8");
  const code = stripComments(src);
  ok("1. the real production/source/demo URLs are used", code.includes(PRODUCTION_URL) && code.includes(SOURCE_URL) && code.includes(DEMO_URL));
  ok("2. no claim of an independent security audit or penetration test anywhere in executable text", !/security audit|penetration test/i.test(code));
  ok("3. no claim of 'six fully localized rooms' anywhere in executable text", !/fully localized/i.test(code));
  ok("4. no claim of organizational adoption / product-market fit", !/product.market fit|\bPMF\b|organizations have adopted/i.test(code));
  ok("5. no claim that the geography RLS fix is live", !/RLS fix is live|RLS.*applied/i.test(code));
  ok("6. no WCAG compliance claim", !/WCAG/i.test(code));
  ok("7. the demo is explicitly described as synthetic/editorial, not live production data", /synthetic editorial demo/i.test(code));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);

// ============================================================
// ELECTIONCANON — GATE A.5.4 PHASE 2.1: legacy Studio public-content boundary
//
// Phase 2 left one gap open: the freeform Campaign Studio Design-tab flow
// bypassed design/creative.js entirely, so its 21 existing templates were
// never protected by the same "renderer only ever sees an explicit public
// payload" boundary Communications already had. This file proves that gap
// is closed — WITHOUT reducing the 21 templates to the Communications
// 4-slot vocabulary and without redesigning any of them.
//
// No live database, no real <canvas> — same hand-rolled-fake-canvas
// precedent as every other consumer test in this suite.
// ============================================================

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join } from "path";
import { buildCommunicationCreativePayload, buildStudioCreativePayload, validateCreativePayload } from "../src/domains/election/design/creative.js";
import { TEMPLATES, TEMPLATE_LIST, ASSET_TYPE } from "../src/domains/election/design/templates.js";
import { renderTemplateToCanvas } from "../src/domains/election/design/render.js";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log("\nELECTIONCANON — Gate A.5.4 Phase 2.1: legacy Studio public-content boundary\n");

// Same font-size-aware measureText approximation as
// election-creative-payload.consumer.mjs's fakeCanvas() — see that file's
// own comment. A flat per-character constant can't distinguish a large
// headline from small body text, which wrapping/overflow behavior
// depends on.
function fakeCanvas(width, height) {
  const calls = { fillText: [] };
  const ctx = {
    fillStyle: null, font: null, textBaseline: null,
    fillRect: () => {},
    fillText: (text, x, y) => calls.fillText.push({ text, x, y }),
    measureText: (text) => {
      const sizeMatch = /(\d+(?:\.\d+)?)px/.exec(ctx.font || "");
      const fontSize = sizeMatch ? parseFloat(sizeMatch[1]) : 16;
      return { width: String(text).length * fontSize * 0.55 };
    },
  };
  return { width, height, getContext: () => ctx, _calls: calls };
}

// ============================================================
console.log("REQUIRED — the critical internal-field test (Phase 2.1 section 4)");
// ============================================================
{
  // A REAL existing Studio template, chosen for its known, small public
  // vocabulary: ASSET_TYPE.ANNOUNCEMENT declares exactly textSlots
  // [headline, body] — nothing else. Unchanged by this gate.
  const template = TEMPLATES[ASSET_TYPE.ANNOUNCEMENT];
  ok("PRE. sanity check — this template's own declared public vocabulary is exactly headline+body", template.textSlots.map((s) => s.id).sort().join(",") === "body,headline");

  const asset = {
    content: {
      text: {
        headline: "Public headline",
        body: "Public body",
        brief: "SECRET INTERNAL BRIEF",
        created_by: "SECRET-CREATOR-ID",
        reviewer_id: "SECRET-REVIEWER-ID",
        approver_id: "SECRET-APPROVER-ID",
        status: "approved",
        internal_notes: "SECRET NOTES",
        shouldNeverRender: "SECRET",
      },
    },
  };

  const payload = buildStudioCreativePayload({ asset, template, identity: {} });

  ok("L1. only the template's OWN declared slots appear in payload.content", Object.keys(payload.content).sort().join(",") === "body,headline");
  ok("L2. headline carries the intended public value", payload.content.headline === "Public headline");
  ok("L3. body carries the intended public value", payload.content.body === "Public body");

  const serialized = JSON.stringify(payload);
  ok("L4. brief does not appear anywhere in the payload", !serialized.includes("SECRET INTERNAL BRIEF"));
  ok("L5. created_by does not appear", !serialized.includes("SECRET-CREATOR-ID"));
  ok("L6. reviewer_id does not appear", !serialized.includes("SECRET-REVIEWER-ID"));
  ok("L7. approver_id does not appear", !serialized.includes("SECRET-APPROVER-ID"));
  ok("L8. status ('approved') does not appear as a rendered value", !serialized.includes("\"approved\""));
  ok("L9. internal_notes does not appear", !serialized.includes("SECRET NOTES"));
  ok("L10. the unexpected arbitrary field 'shouldNeverRender' does not appear, under any key", !serialized.includes("SECRET\""));

  const validation = validateCreativePayload({ payload, template });
  ok("L11. the resulting (already-filtered) payload validates cleanly", validation.valid);

  const canvas = fakeCanvas(1080, 1080);
  renderTemplateToCanvas({ canvas, template, payload });
  const rendered = canvas._calls.fillText.map((c) => c.text);
  ok("L12. the renderer drew ONLY the two public strings — exactly two fillText calls", rendered.length === 2);
  ok("L13. no internal value reached fillText, from a fixture designed to leak everything if the boundary had any hole",
    !rendered.some((t) => /SECRET|approved/.test(t)));
  ok("L14. both intended public strings genuinely rendered", rendered.includes("Public headline") && rendered.includes("Public body"));
}

// ============================================================
console.log("\nDefense in depth — validateCreativePayload rejects a HAND-BUILT payload smuggling an undeclared key past this template");
// ============================================================
{
  const template = TEMPLATES[ASSET_TYPE.ANNOUNCEMENT];
  const smuggled = { content: { headline: "H", body: "B", brief: "SMUGGLED" }, visual: {}, identity: {} };
  const result = validateCreativePayload({ payload: smuggled, template });
  ok("M1. a hand-built payload with an extra key not declared by THIS legacy template is rejected", !result.valid);
  ok("M2. the rejection names the offending key", /brief/i.test(result.error));
}

// ============================================================
console.log("\nIdentity safety — legacy path");
// ============================================================
{
  const template = TEMPLATES[ASSET_TYPE.ANNOUNCEMENT];
  const asset = { content: { text: { headline: "H" }, identity: { campaignName: "a52owner" } } };

  const noBrand = buildStudioCreativePayload({ asset, template, identity: {} });
  ok("ID1. asset.content.identity (the historical campaignName leak) is never read by the legacy builder", noBrand.identity.brand === null);

  const canvas = fakeCanvas(1080, 1080);
  renderTemplateToCanvas({ canvas, template, payload: noBrand });
  ok("ID2. with no explicit brand, nothing renders except the declared content — no seeded internal identifier appears",
    !canvas._calls.fillText.some((c) => c.text === "a52owner"));

  const withBrand = buildStudioCreativePayload({ asset, template, identity: { brand: "ElectionCanon" } });
  const canvas2 = fakeCanvas(1080, 1080);
  renderTemplateToCanvas({ canvas: canvas2, template, payload: withBrand });
  ok("ID3. an EXPLICITLY supplied public brand value still renders", canvas2._calls.fillText.some((c) => c.text === "ElectionCanon"));
}

// ============================================================
console.log("\nCommunications path preserved (unchanged behavior)");
// ============================================================
{
  const payload = buildCommunicationCreativePayload({
    communication: { title: "Election Day Reminder", brief: "SECRET", created_by: "SECRET-ID" },
    languageVariant: { text: "Polls open 8am.", status: "approved", reviewer_id: "SECRET-REV" },
    identity: { brand: "ElectionCanon" },
  });
  ok("COMMS1. headline/body still come from title/text only", payload.content.headline === "Election Day Reminder" && payload.content.body === "Polls open 8am.");
  ok("COMMS2. brief/created_by/status/reviewer_id still never appear", !JSON.stringify(payload).match(/SECRET/));
}

// ============================================================
console.log("\nRenderer contract — no caller constructs a raw textBySlot/application object anymore");
// ============================================================
{
  const repoRoot = fileURLToPath(new URL("../", import.meta.url));
  const studioSrc = readFileSync(join(repoRoot, "src", "pages", "election", "CampaignStudioSection.jsx"), "utf8");
  const commsSrc = readFileSync(join(repoRoot, "src", "pages", "election", "Communications.jsx"), "utf8");
  const exportSrc = readFileSync(join(repoRoot, "src", "domains", "election", "communications", "export.js"), "utf8");

  // Scoped to exportPng()'s own body, not the whole file — the Editor's
  // setText() handler legitimately spreads asset.content.text to produce
  // an immutable REACT STATE update copy while a user types (unrelated to
  // the render/export payload boundary this file is testing).
  const exportPngBody = studioSrc.slice(studioSrc.indexOf("async function exportPng"), studioSrc.indexOf("function Editor"));

  ok("RC1. exportPng() no longer builds a raw textBySlot object", !exportPngBody.includes("textBySlot"));
  ok("RC2. communications/export.js no longer builds a raw textBySlot object", !exportSrc.includes("textBySlot"));
  ok("RC3. CampaignStudioSection.jsx routes exportPng through buildStudioCreativePayload", studioSrc.includes("buildStudioCreativePayload"));
  ok("RC4. exportPng() never spreads asset.content.text directly into a payload", !exportPngBody.includes("...asset.content.text"));
  ok("RC5. Communications.jsx never passes a raw communication/languageVariant object straight into the renderer (no renderTemplateToCanvas import there at all — it only calls exportApprovedVariant)", !commsSrc.includes("renderTemplateToCanvas"));
}

// ============================================================
console.log("\nAll 21 existing templates remain structurally usable, unrenamed, unredesigned");
// ============================================================
{
  ok("TPL1. exactly the same 21 templates still exist", TEMPLATE_LIST.length === 21);
  let allResolve = true, allRoundTrip = true;
  for (const template of TEMPLATE_LIST) {
    const defs = template.textSlots;
    if (!Array.isArray(defs) || defs.length === 0) { allResolve = false; continue; }
    const fakeAsset = { content: { text: Object.fromEntries(defs.map((s) => [s.id, `value-for-${s.id}`])) } };
    const payload = buildStudioCreativePayload({ asset: fakeAsset, template, identity: {} });
    const validation = validateCreativePayload({ payload, template });
    if (!validation.valid) allRoundTrip = false;
    if (defs.some((s) => payload.content[s.id] !== `value-for-${s.id}`)) allRoundTrip = false;
  }
  ok("TPL2. every existing template resolves a non-empty public slot declaration", allResolve);
  ok("TPL3. every existing template's own declared slots round-trip through build+validate unchanged", allRoundTrip);
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
if (fail > 0) process.exit(1);

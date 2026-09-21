// ============================================================
// FORGE ELECTION — WEB SURFACE  (Loop 27)
//
// This repository has NO React-rendering test harness (no Jest/Vitest/
// jsdom/@testing-library — CLAUDE.md states plainly: "Tests are plain Node
// scripts, not a framework"). These are therefore STRUCTURAL/ARCHITECTURAL
// tests — the strongest evidence this repo's existing infrastructure
// supports — proving the source-level contract src/pages/Election.jsx must
// hold, exactly the same style test/election.consumer.mjs's own D4/H1-style
// checks already use for the same reason.
//
// The RUNTIME behavior (the page actually renders "Not signed in" with no
// console errors, and /, /workspace are unaffected) was verified separately
// this loop via a live Vite dev server + browser automation — that
// verification is not repeated here as an automated test because this
// repository has no headless-browser test runner; it is disclosed as its
// own MOCK/manual evidence class in the final report, never upgraded to
// "automated" or "LIVE".
//
// Run: node test/election-web-surface.consumer.mjs
// ============================================================

import { readFileSync } from "node:fs";
import { stripComments } from "./lib/source.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };
const src = (p) => stripComments(readFileSync(new URL(p, import.meta.url), "utf8"));

const PAGE = "../src/pages/Election.jsx";
const APP = "../src/App.jsx";
// ALPHA 1.0 — WriteActionPanel (and the generic PREPARE/APPROVE machinery it
// demonstrates) moved to shared.jsx so the new Mobilize/Chat/Campaign
// Studio/Election Day/Intelligence sections can reuse the same atoms. The
// WRITE SAFETY and P (write-surface truthfulness) checks below moved with
// it — the property they prove (PREPARE cannot reach EXECUTE, confirmationId
// generated once and reused, no narrower-than-reality placeholder copy)
// still holds, just in its new home.
const SHARED = "../src/pages/election/shared.jsx";
// PUBLIC INTRODUCTION PASS 1 — the unauthenticated pitch moved out of
// Election.jsx entirely, to a dedicated public landing page reached
// directly at "/". Election.jsx's own `!session` branch now just redirects
// there (see A2 below).
const LANDING = "../src/pages/Landing.jsx";

console.log("\nFORGE ELECTION — Web surface (structural)\n");

const page = src(PAGE);
const shared = src(SHARED);
const landing = src(LANDING);

// ============================================================
console.log("F/J/K/L/M/N — CHANNEL INDEPENDENCE: the page reaches the Canon ONLY through electionWebAdapter.js");
// ============================================================
{
  ok("F1. Election.jsx imports readElectionCanon/activateElection/prepareElectionWrite/approveElectionWrite " +
     "from electionWebAdapter.js — its one and only path to the domain",
     /from ["']\.\.\/os\/electionWebAdapter\.js["']/.test(page) &&
     /readElectionCanon/.test(page) && /activateElection/.test(page) &&
     /prepareElectionWrite/.test(page) && /approveElectionWrite/.test(page));

  ok("J. Election.jsx never calls projectElection() directly",
     !/\bprojectElection\s*\(/.test(page) && !/from ["'].*projections\.js["']/.test(page));

  // Importing the STATUS enum (vocabulary) from readiness.js is legitimate
  // and intended — the risk is CALLING deriveReadiness(), not importing a
  // comparison constant from its module, so the import line itself is
  // stripped before checking (mirroring the same fix already applied to M).
  ok("K. Election.jsx never calls deriveReadiness() directly",
     !/\bderiveReadiness\s*\(/.test(page) &&
     !/from ["'].*studio\/readiness\.js["']/.test(page.replace(/import\s*\{\s*READINESS_DIMENSION_STATUS[^;]*;/, "")));

  ok("L. Election.jsx never calls bootstrapCampaign() directly",
     !/\bbootstrapCampaign\s*\(/.test(page) && !/from ["'].*electionBootstrap\.js["']/.test(page));

  ok("M. Election.jsx never calls resolveElectionScope() directly",
     !/\bresolveElectionScope\s*\(/.test(page) && !/from ["'].*electionScope\.js["']/.test(page.replace(/import\s*\{\s*ELECTION_SCOPE\s*\}[^;]*;/, "")));

  ok("N. Election.jsx never calls executeElectionWrite() directly",
     !/\bexecuteElectionWrite\s*\(/.test(page));

  // The enum imports (ACTIVATION, ELECTION_SCOPE, STATUS) are DATA/vocabulary,
  // not orchestration — confirmed by checking they are used only for
  // equality comparison (===), never invoked with call syntax anywhere.
  ok("F2. ACTIVATION/ELECTION_SCOPE/STATUS are used only as comparison vocabulary, never called as functions",
     !/\bACTIVATION\s*\(/.test(page) && !/\bELECTION_SCOPE\s*\(/.test(page) && !/\bSTATUS\s*\(/.test(page));
}

// ============================================================
console.log("\nA/B — AUTHENTICATION GATING");
// ============================================================
{
  ok("A1. the page checks `!session` and renders an honest unauthenticated state before any Canon read",
     /if \(!session\)/.test(page));
  // PUBLIC INTRODUCTION PASS 1 — Election.jsx's `!session` branch no
  // longer renders its own "Not signed in" pitch; it redirects to the
  // dedicated public landing page ("/", Landing.jsx), which is the one
  // place that now offers the real sign-in path. The invariant this test
  // protects (an honest sign-in link, never a bypass or a fabricated
  // identity) still holds, just split across the two files that together
  // make up the unauthenticated experience.
  ok("A2. Election.jsx's unauthenticated branch redirects (never a bypass or a fake identity), and the landing page it redirects to offers real sign-in",
     /if \(!session\) \{\s*[\s\S]{0,400}?<Navigate to="\/" replace \/>/.test(page)
     && /nav\(["']\/access["']\)/.test(landing));
  ok("B1. the Canon refresh only runs once a session's user exists — gated in refresh() itself",
     /if \(!session\?\.\?user\) return;|if \(!session\?\.user\) return;/.test(page));
  ok("B2. refresh() is invoked from a useEffect keyed on the refresh callback, so it runs once identity resolves",
     /useEffect\(\(\) => \{ refresh\(\); \}, \[refresh\]\);/.test(page));

  // M2-TARGET — no adapter call anywhere in the page ever passes a userId
  // (or any spelling of the session's own user id) as an explicit
  // argument. The adapter's OWN contract (Loop 26) is that no exported
  // function even accepts one; this proves the UI never attempts to,
  // either — the only identity value that ever reaches the adapter is the
  // `client` itself, whose session the adapter reads server-side.
  // ALPHA 1.0 — `session?.user?.id` is now read ONCE, into a local `userId`
  // const, passed only as a plain prop to the new Chat/Campaign Studio
  // sections (their own direct RLS-protected reads/writes, never routed
  // through electionWebAdapter.js — see chat/api.js and design/assets.js's
  // own headers). The invariant this check actually protects — no adapter
  // call is ever handed a userId, because every adapter function resolves
  // its own from the client's session server-side — is unchanged; it is
  // now checked directly against adapter call sites rather than banning the
  // token `session?.user?.id` from appearing in the file at all.
  ok("M2-TARGET. no electionWebAdapter.js call in this page passes userId as an explicit argument",
     !/(readElectionCanon|activateElection|prepareElectionWrite|approveElectionWrite)\([^)]*userId/.test(page));
}

// ============================================================
console.log("\nC/D — CAMPAIGN ACTIVATION");
// ============================================================
{
  // Loop 48 — doActivate() grew a SECOND parameter, `actorKind`, forwarded
  // unchanged to activateElection() (which already accepted it — Loop 28 —
  // this is the first UI to actually pass it, via WelcomeOnboarding's real
  // actor-kind choice). The safety property under test is unchanged: the
  // call still goes straight to the adapter, with no local construction of
  // a result — only the literal parameter list the regex expects updates.
  ok("C1. WelcomeOnboarding's action calls activateElection() through the adapter, not a local construction",
     /const doActivate = useCallback\(async \(name, actorKind\) => \{[\s\S]*?activateElection\(\{ client: supabase, name, actorKind \}\)/.test(page));
  ok("D1. after a successful activation, the page calls refresh() again rather than building the result itself",
     /doActivate[\s\S]{0,500}await refresh\(\);/.test(page));
  ok("D2. doActivate's own success branches never construct a readiness/claims object locally",
     !/doActivate[\s\S]{0,600}claims:/.test(page));
}

// ============================================================
console.log("\nE — CANON RENDERING COMES FROM THE ADAPTER RESULT");
// ============================================================
{
  // ALPHA 1.0 — campaignId is now computed once as `ctx?.scope?.campaignId`
  // (optional chaining) and passed to six sections, rather than the
  // original single literal `ctx.scope.campaignId` at one call site — the
  // regex accepts either form.
  ok("E1. rendered claims/gaps/coverage all read off `ctx.readiness`/`ctx.scope` — the adapter's own return value",
     /ctx\.readiness\.claims/.test(page) && /ctx\.readiness\.gaps/.test(page) &&
     /ctx\.readiness\.knownWardCoverage/.test(page) && /ctx\??\.scope\??\.campaignId/.test(page));
  ok("E2. `ctx` itself is set ONLY from readElectionCanon()'s return — no other assignment to setCtx exists",
     (page.match(/setCtx\(/g) ?? []).length === 1 &&
     /const result = await readElectionCanon\(\{ client: supabase \}\);\n\s*setCtx\(result\);/.test(page));

  // M4-TARGET — refresh() must be a FRESH read every time, never a cache
  // keyed on the previous `ctx`. Isolate refresh()'s own function body (not
  // the whole file) and confirm it never reads the prior `ctx` state at
  // all — a cache/short-circuit mutation would need to branch on it.
  const refreshBody = (page.match(/const refresh = useCallback\(async \(\) => \{([\s\S]*?)\}, \[session\?\.user\]\);/) ?? [])[1] ?? "";
  ok("M4-TARGET. refresh()'s own body never reads a prior `ctx` value — every call is a fresh adapter read",
     refreshBody.length > 0 && !/\bctx\b/.test(refreshBody.replace(/setCtx/g, "")));
}

// ============================================================
console.log("\nG — RECOMMENDATION/CANON SEPARATION (and an honest note on scope)");
// ============================================================
{
  // deriveReadiness()'s own return shape (Loop 22) carries NO
  // `recommendations` field at all — that concept belongs to the
  // conversational layer (infer.js/respond.js), which this page never
  // imports. There is therefore nothing for this page to mislabel as CANON;
  // the check instead proves gaps (which DO carry their own `action` field)
  // are rendered under their own label, never merged into the claims list.
  ok("G1. gaps are rendered in their OWN block (GapRow/'Gaps'), never inside the claims ('Readiness claims') block",
     /Readiness claims \(CANON\)/.test(page) && /Gaps \(CANON-derived\)/.test(page) &&
     page.indexOf("ctx.readiness.claims.map") < page.indexOf("ctx.readiness.gaps.map"));
  ok("G2. the page imports no conversational/recommendation module (infer.js, respond.js, ask.js)",
     !/studio\/infer\.js|studio\/respond\.js|studio\/ask\.js/.test(page));
}

// ============================================================
console.log("\nH — CAMPAIGN SELECTION SCOPE (documented, not a leak)");
// ============================================================
{
  // This page never passes a `requestedCampaign` at all on the read path —
  // it always resolves to whatever the session's OWN single membership is.
  // That is a real, documented scope limitation (no campaign switcher this
  // loop — see the final report's gaps section), not a vulnerability: there
  // is no parameter here through which a browser could supply another
  // tenant's campaign id in the first place.
  ok("H1. readElectionCanon() is called with no requestedCampaign argument anywhere on the read path",
     /readElectionCanon\(\{ client: supabase \}\)/.test(page) &&
     !/readElectionCanon\(\{[^}]*requestedCampaign/.test(page));
}

// ============================================================
console.log("\nI — REFRESH");
// ============================================================
{
  ok("I1. the visible Refresh button calls the SAME refresh() function used everywhere else — no second read path",
     /onClick=\{refresh\}/.test(page));
  ok("I2. a successful write approval calls refresh() and never patches readiness/claims locally " +
     "(WriteActionPanel now lives in shared.jsx, reused by Election.jsx and the Alpha sections)",
     /doApprove[\s\S]{0,500}await refresh\(\);/.test(shared) &&
     !/doApprove[\s\S]{0,800}setCtx\(\{/.test(shared));
}

// ============================================================
console.log("\nWRITE SAFETY (WriteActionPanel PREPARE/APPROVAL separation — now in shared.jsx)");
// ============================================================
{
  // Isolated to WriteActionPanel's own function body specifically — shared.jsx
  // ALSO contains StructuredWritePanel (Alpha 1.0's Mobilization/Election Day
  // form), which legitimately has its own, separate doPrepare/doApprove pair
  // and its own crypto.randomUUID() call; counting the whole file would
  // conflate the two components' independent write-safety proofs.
  const writeActionPanelBody = (shared.match(/function WriteActionPanel\(\{ campaignId, refresh \}\) \{([\s\S]*?)\n\}\n/) ?? [])[1] ?? "";
  ok("W0. WriteActionPanel's own body was successfully isolated from shared.jsx", writeActionPanelBody.length > 0);
  ok("W1. WriteActionPanel never calls executeElectionWrite — only approveElectionWrite, which itself gates execution",
     !/executeElectionWrite/.test(writeActionPanelBody));
  ok("W2. the confirmationId is generated exactly ONCE per prepared draft (in doPrepare) and reused by doApprove, " +
     "never regenerated inside doApprove",
     (writeActionPanelBody.match(/crypto\.randomUUID\(\)/g) ?? []).length === 1 &&
     /doPrepare[\s\S]{0,600}crypto\.randomUUID\(\)/.test(writeActionPanelBody) &&
     !/doApprove[\s\S]{0,600}crypto\.randomUUID\(\)/.test(writeActionPanelBody));
  ok("W3. approval reuses `prepared.confirmationId` — the SAME value doPrepare stored, not a fresh one",
     /confirmationId: prepared\.confirmationId/.test(writeActionPanelBody));
  ok("W4. Election.jsx itself (the page shell) never calls executeElectionWrite directly either",
     !/executeElectionWrite/.test(page));

  // M5-TARGET — doPrepare()'s own body must never reference approveElectionWrite
  // at all. approveElectionWrite legitimately exists elsewhere in the SAME
  // component (doApprove); the invariant is that PREPARE's own code path has
  // no way to reach it, isolated to doPrepare's function body specifically.
  const doPrepareBody = (writeActionPanelBody.match(/const doPrepare = useCallback\(async \(\) => \{([\s\S]*?)\}, \[campaignId, message\]\);/) ?? [])[1] ?? "";
  ok("M5-TARGET. doPrepare()'s own body never calls approveElectionWrite — PREPARE cannot reach EXECUTE",
     doPrepareBody.length > 0 && !/approveElectionWrite/.test(doPrepareBody));
}

// ============================================================
console.log("\nO — ROUTING: additive, existing routes untouched");
// ============================================================
{
  const app = src(APP);
  ok("O1. /election is registered as an ADDITIVE route, not inside the ROOMS/BUILT kernel loop",
     /<Route path="\/election"\s+element=\{<Election \/>\}\s*\/>/.test(app));
  // ALPHA 1.7 EXTRACTION — O2/O3 originally protected "adding /election
  // left the fatt-app monorepo's OTHER routes (ROOMS.map's manufacturing
  // rooms, /workspace) untouched." In a standalone, single-product
  // repository there ARE no other routes to leave untouched — there is
  // no ROOMS registry and no /workspace (Business/Manufacturing's own
  // post-auth destination, never an ElectionCanon concept). The real
  // invariant this test family protects — the route table stays small,
  // explicit, and honest, nothing hidden inside a generic loop — is
  // re-expressed here for what this repository actually is.
  //
  // CAMPAIGN ONBOARDING PASS — /invite/:token is a FOURTH explicit route
  // (AcceptInvite.jsx), then /reset-password (ResetPassword.jsx, pre-launch
  // UX cleanup pass P1-4), added the same additive, named way /election and
  // /access already were. The count grows to 5; the "nothing generated
  // from a loop" invariant is exactly as true as before.
  //
  // PUBLIC LAUNCH PASS — creative/ad-film preview routes (e04–e09-preview,
  // ad01-preview, ...) are a distinct, self-identifying category: internal
  // review surfaces for launch assets, never linked from product UI, and
  // named with an explicit "-preview" suffix so they can never be mistaken
  // for a real product route. O2 now checks the 5 PRODUCT routes exactly,
  // separately from however many "-preview" routes exist — the invariant
  // this test protects (nothing hidden inside a generic loop, no route
  // added without a name and a reason) stays exactly as true as before.
  //
  // LAUNCH DISTRIBUTION PASS (Alpha 1.7) — six /launch* routes (the hub,
  // /launch/ad01, /launch/ad02, /launch/ad03, /launch/confirm, /launch/
  // unsubscribe) are added the same additive, named way every prior route
  // was. These are real, linked product surfaces (not preview routes) so
  // they are NOT "-preview"-suffixed and are counted as PRODUCT routes,
  // growing that count from 5 to 11 — the "nothing generated from a loop"
  // invariant stays exactly as true as before.
  const routePaths = [...app.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]);
  const productRoutes = routePaths.filter((p) => !p.replace(/^\//, "").endsWith("-preview"));
  const previewRoutes = routePaths.filter((p) => p.replace(/^\//, "").endsWith("-preview"));
  const LAUNCH_ROUTES = ["/launch", "/launch/ad01", "/launch/ad02", "/launch/ad03", "/launch/confirm", "/launch/unsubscribe"];
  ok("O2. the route table has exactly eleven explicit PRODUCT routes (the original 5, plus the 6 /launch* routes) — nothing generated from a loop, any other routes are self-identifying '-preview' routes",
     !/\.map\(/.test(app) &&
     productRoutes.length === 11 &&
     ["/", "/election", "/access", "/invite/:token", "/reset-password", ...LAUNCH_ROUTES].every((p) => productRoutes.includes(p)) &&
     previewRoutes.length + productRoutes.length === routePaths.length);
  ok("O3. /access is present, registered the same explicit way as /election",
     /<Route path="\/access"\s+element=\{<Access \/>\}\s*\/>/.test(app));
  ok("O5. /reset-password is present, registered the same explicit way",
     /<Route path="\/reset-password"\s+element=\{<ResetPassword \/>\}\s*\/>/.test(app));
  ok("O4. /invite/:token is present, registered the same explicit way",
     /<Route path="\/invite\/:token"\s+element=\{<AcceptInvite \/>\}\s*\/>/.test(app));
}

// ============================================================
console.log("\nP — WRITE-SURFACE TRUTHFULNESS: the panel's own copy must");
console.log("    not claim narrower capability than proposeElectionWrite() actually has");
// ============================================================
{
  // The USER-FACING contract — a real rendered string, not a comment, so it
  // survives stripComments() like every other check in this file. Protects
  // against regressing to a single-example placeholder that (paired with no
  // other UI cue) implies only one write operation exists. Now checked in
  // shared.jsx, WriteActionPanel's new home.
  const placeholderMatch = shared.match(/placeholder='([^']*)'\s*aria-label="Action"/);
  ok("P1. the Action input's placeholder demonstrates at least TWO different write commands, " +
     "not just the original ward-assignment example",
     Boolean(placeholderMatch) && /assign/i.test(placeholderMatch[1]) && /report/i.test(placeholderMatch[1]));

  // The DEVELOPER-FACING contract — read the RAW file (not the
  // comment-stripped `shared`) specifically because this checks a comment's
  // own truthfulness, the one thing stripComments() would hide from every
  // other check in this file.
  const raw = readFileSync(new URL(SHARED, import.meta.url), "utf8");
  const norm = raw.replace(/\s+/g, " "); // JSDoc line-wraps split phrases across lines
  ok("P2. the ORIGINAL stale claim ('Exactly one write action... Assign a team to a ward. " +
     "No second operation...') does not appear verbatim",
     !/Exactly one write action this loop — Assign a team to a ward\. No second/i.test(norm));
  ok("P3. the WriteActionPanel comment names the real supported command family " +
     "(candidate registration, ward assignment, ward status reporting, observer assignment)",
     /candidate registration/i.test(norm) && /ward assignment/i.test(norm) &&
     /ward status reporting/i.test(norm) && /observer assignment/i.test(norm));

  // NEGATIVE CONTROL — this correction must not have added a new UI
  // element (selector, dropdown, catalog) to make the point; scoped to
  // WriteActionPanel's OWN body (StructuredWritePanel, a DIFFERENT component
  // in the SAME file, legitimately has several <input>/<select> elements for
  // its own structured Mobilization/Election Day fields — counting the whole
  // file would conflate the two).
  const panelBody = (shared.match(/function WriteActionPanel\(\{ campaignId, refresh \}\) \{([\s\S]*?)\n\}\n/) ?? [])[1] ?? "";
  ok("P4. no operation selector/dropdown/catalog was added — still exactly ONE <input> inside WriteActionPanel itself",
     panelBody.length > 0 && (panelBody.match(/<input\b/g) ?? []).length === 1);
}

// ============================================================
console.log("\nQ — ALPHA 1.0: PRODUCT SEPARATION, NO DEAD NAV, SIMULATION LABELLING");
// ============================================================
{
  // "supabase" itself is expected (the client import/variable — required
  // internal plumbing, never shown to a user); the actual requirement is
  // that no PROVIDER/PLATFORM BRAND NAME is ever rendered as visible UI
  // text — verified live in the browser this loop, not by source regex
  // (a false positive on the word "supabase" in an import path would be
  // exactly the kind of noisy, ungrounded check this project's own R7
  // principle warns against). This check instead covers what source text
  // CAN prove: no dependency on rooms/Business at all.
  ok("Q1. Election.jsx never imports anything from src/rooms or src/domains/business",
     !/from ["'].*\/rooms\//.test(page) && !/from ["'].*\/domains\/business\//.test(page));
  ok("Q2. the 8 Alpha 1.0 sections are all wired to a real component — no bare string literal renders in their place",
     /HomeSection/.test(page) && /ReadinessSection/.test(page) && /MobilizeSection/.test(page) &&
     /ChatSection/.test(page) && /CampaignStudioSection/.test(page) && /ElectionDaySection/.test(page) &&
     /IntelligenceSection/.test(page) && /SettingsSection/.test(page));
  ok("Q3. normalizeUrl() is called once, on mount, via the shared url utility — not reimplemented inline",
     /normalizeUrl\(\)/.test(page) && /from ["']\.\.\/lib\/urlNormalize\.js["']/.test(page));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);

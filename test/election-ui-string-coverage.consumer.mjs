// ============================================================
// ELECTIONCANON — UI STRING TRANSLATION COVERAGE  (Six-Language Pass 2)
//
// Proves uiStrings.js actually backs the real, wired ElectionCanon UI in
// all six languages — not merely that six language objects exist. Every
// key checked here is extracted from the ACTUAL t("...") call sites in
// src/pages/election/*.jsx, src/pages/Election.jsx, and (VISIBILITY
// EXPANSION PASS) src/pages/Landing.jsx — the public landing page, which
// had zero t() call sites before that pass and is now included so its new
// landing.* keys get the exact same six-language coverage proof as every
// other screen, not a separate unchecked system (plus the dynamic
// RESPONSIBILITY_ROLE_LABEL_KEY[...] lookups in OrganisationSection.jsx,
// added explicitly below) — never a hand-typed list that could drift from
// what the UI really consumes.
//
// WHAT "COVERED" MEANS HERE. For each consumed key and each non-English
// language, exactly one of two things must be true:
//   (a) the language object defines a genuine, non-empty translation, OR
//   (b) the key is listed in uiStrings.js's own INTENTIONAL_FALLBACKS
//       registry, documenting WHY it intentionally falls back to English
//       (pluralization-grammar risk for readiness.countTemplate.*, or
//       Urhobo's own documented lack of sourced vocabulary).
// A key that is neither is an unflagged gap — this file fails on those,
// not on documented fallbacks.
//
// Run: node test/election-ui-string-coverage.consumer.mjs
// ============================================================

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  UI_TRANSLATIONS, SAFETY_GATED_KEYS, INTENTIONAL_FALLBACKS, isIntentionalFallback,
  URHOBO_PROPOSAL_STATUS, t,
} from "../src/pages/election/uiStrings.js";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };
const code = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const NON_ENGLISH = ["ha", "ig", "pcm", "urh", "yo"];
const ALL_SIX = ["en", ...NON_ENGLISH];

console.log("\nELECTIONCANON — UI string translation coverage (Six-Language Pass 2)\n");

// ============================================================
console.log("A — AUTHORITATIVE KEY SET: extracted from the real wired UI, not hand-typed");
// ============================================================
const electionDir = join("src", "pages", "election");
const sectionFiles = readdirSync(new URL(`../${electionDir}`, import.meta.url))
  .filter((f) => f.endsWith(".jsx"))
  .map((f) => join(electionDir, f));
sectionFiles.push(join("src", "pages", "Election.jsx"));
sectionFiles.push(join("src", "pages", "Landing.jsx"));

const literalKeyRe = /\bt\(\s*["']([a-zA-Z0-9_.]+)["']/g;
const usedKeys = new Set();
for (const f of sectionFiles) {
  const src = code(`../${f}`);
  let m;
  while ((m = literalKeyRe.exec(src))) usedKeys.add(m[1]);
}
// The dynamic RESPONSIBILITY_ROLE_LABEL_KEY[...] lookups in
// OrganisationSection.jsx resolve to these four — already present above
// via other literal call sites (RoleButton labels), named explicitly here
// so this file's own key set is self-contained and doesn't rely on that
// coincidence.
["role.constituencyLead", "role.lgaCoordinator", "role.wardCoordinator", "role.puAgent", "role.director"]
  .forEach((k) => usedKeys.add(k));
// Same reason: HomeSection.jsx's `t(NEXT_ACTION_KEY_BY_DIMENSION[...] ??
// "home.nextActionReviewGaps")` is a dynamic call the literal-string regex
// above cannot see — named explicitly so this file doesn't silently miss
// the "what to do next" sentence shown on Home (found via live browser
// verification, not the original inventory — see uiStrings.js's own log).
["home.nextActionCandidateRegistered", "home.nextActionWardAssignment", "home.nextActionWardStatusHealth",
  "home.nextActionObserverAssignment", "home.nextActionReviewGaps"].forEach((k) => usedKeys.add(k));

ok("1. at least 150 distinct keys were found wired into the real UI (sanity floor — catches a broken extraction regex)",
  usedKeys.size >= 150);
ok("2. every extracted key matches the key-name shape (letters/digits/underscore/dot) — no stray regex garbage",
  Array.from(usedKeys).every((k) => /^[a-zA-Z0-9_.]+$/.test(k)));

// ============================================================
console.log("\nB — ENGLISH: every consumed key has a real, non-empty English value");
// ============================================================
{
  const missingFromEn = Array.from(usedKeys).filter((k) => !(k in UI_TRANSLATIONS.en));
  ok("1. no consumed key is missing from `en` — English is the fallback floor; a gap here would mean a broken UI, not just an untranslated one",
    missingFromEn.length === 0);
  const emptyEn = Array.from(usedKeys).filter((k) => {
    const v = UI_TRANSLATIONS.en[k];
    return typeof v !== "string" || v.trim() === "";
  });
  ok("2. no consumed key's English value is empty/undefined/null",
    emptyEn.length === 0);
}

// ============================================================
console.log("\nC — EVERY LANGUAGE, EVERY KEY: translated OR a documented intentional fallback — never a silent gap");
// ============================================================
{
  for (const lang of NON_ENGLISH) {
    const unflagged = Array.from(usedKeys).filter((k) => {
      const hasTranslation = k in UI_TRANSLATIONS[lang];
      if (hasTranslation) return false;
      return !isIntentionalFallback(k, lang);
    });
    ok(`1.${lang} every consumed key is either translated or an explicit INTENTIONAL_FALLBACKS entry — ${unflagged.length === 0 ? "zero unflagged gaps" : `${unflagged.length} unflagged: ${unflagged.slice(0, 5).join(", ")}`}`,
      unflagged.length === 0);
  }
}

// ============================================================
console.log("\nD — NO FABRICATED-LOOKING VALUES: no undefined/null/empty/placeholder garbage in any language object");
// ============================================================
{
  for (const lang of ALL_SIX) {
    const obj = UI_TRANSLATIONS[lang];
    const bad = Object.entries(obj).filter(([, v]) =>
      v === undefined || v === null || (typeof v === "string" && v.trim() === "") ||
      /^(TODO|TBD|FIXME|XXX|lorem ipsum)$/i.test(String(v).trim()));
    ok(`1.${lang} no key resolves to undefined/null/empty-string/an obvious TODO placeholder`,
      bad.length === 0);
  }
}

// ============================================================
console.log("\nE — INTERPOLATION INTEGRITY: {var} tokens in any translated value match English's own set exactly");
// ============================================================
{
  const varsOf = (s) => Array.from(String(s).matchAll(/\{(\w+)\}/g)).map((m) => m[1]).sort().join(",");
  for (const lang of NON_ENGLISH) {
    const mismatched = Object.entries(UI_TRANSLATIONS[lang]).filter(([k, v]) => {
      const enVal = UI_TRANSLATIONS.en[k];
      if (enVal === undefined) return false; // not an en key at all — not this file's concern
      return varsOf(v) !== varsOf(enVal);
    });
    ok(`1.${lang} every translated value's {var} placeholders exactly match English's own set for that key (no dropped/renamed variable)`,
      mismatched.length === 0);
  }
  // The seven pluralization-deferred keys are the ONLY interpolated keys
  // in the whole dictionary today; confirm that's still true, so a future
  // addition doesn't silently skip this integrity check's real purpose.
  const interpolatedKeys = Object.entries(UI_TRANSLATIONS.en).filter(([, v]) => /\{\w+\}/.test(v)).map(([k]) => k);
  ok("2. the only interpolated English keys today are the seven documented pluralization-deferred readiness.countTemplate.* keys",
    interpolatedKeys.length === 7 && interpolatedKeys.every((k) => k.startsWith("readiness.countTemplate.")));
}

// ============================================================
console.log("\nF — SAFETY-CRITICAL STRINGS: exist, stay gated, and preserve their full operational meaning where drafted");
// ============================================================
{
  ok("1. SAFETY_GATED_KEYS still names exactly the 5 keys this project designated non-negotiable",
    SAFETY_GATED_KEYS.length === 5 &&
    ["electionDay.simDisclosure", "electionDay.simPhotoDisclosure", "electionDay.simResultsDisclosure", "studio.noAiImageDisclosure", "ask.languageFallbackBanner"]
      .every((k) => SAFETY_GATED_KEYS.includes(k)));

  // Even though a draft exists in UI_TRANSLATIONS for ha/ig/pcm/yo, t()
  // must still return ENGLISH for every one of them until a human
  // approves — this is the gate itself, re-verified here against the
  // real drafted content (not just a structural source-grep, which
  // election-multilingual.consumer.mjs already does elsewhere).
  for (const key of SAFETY_GATED_KEYS) {
    for (const lang of NON_ENGLISH) {
      ok(`2.${key}/${lang} t() returns the ENGLISH value even though a non-English draft exists in UI_TRANSLATIONS`,
        t(key, lang) === UI_TRANSLATIONS.en[key]);
    }
  }

  // Semantic preservation — each drafted simulation disclosure must still
  // carry (a) a "this is simulated/demo" marker and (b) a "not official"
  // negation, in that language's own vocabulary, not just "shorter and
  // prettier." Keyword-based, not full NLP — but a real content check,
  // not just non-emptiness.
  const SIM_MARKERS = {
    ha: { sim: ["kwaikwayo"], official: ["hukuma"] },
    ig: { sim: ["nnomi"], official: ["gọọmentị"] },
    yo: { sim: ["àfarawé"], official: ["ìjọba"] },
    pcm: { sim: ["simulat", "demo"], official: ["official"] },
  };
  for (const key of ["electionDay.simDisclosure", "electionDay.simPhotoDisclosure", "electionDay.simResultsDisclosure"]) {
    for (const [lang, markers] of Object.entries(SIM_MARKERS)) {
      const draft = (UI_TRANSLATIONS[lang][key] ?? "").toLowerCase();
      const hasSim = markers.sim.some((w) => draft.includes(w.toLowerCase()));
      const hasOfficial = markers.official.some((w) => draft.includes(w.toLowerCase()));
      ok(`3.${key}/${lang} draft preserves both the simulation marker and the "not official" marker, not weakened into a shorter/vaguer sentence`,
        hasSim && hasOfficial);
    }
  }

  // ask.languageFallbackBanner — must communicate: answered in English,
  // not the requested language. Each draft must name "English" (in that
  // language's own word for it) and mention ElectionCanon's own answers
  // not existing yet in that language.
  const ENGLISH_WORD = { ha: "ingilishi", ig: "bekee", yo: "gẹ̀ẹ́sì", pcm: "english" };
  for (const [lang, word] of Object.entries(ENGLISH_WORD)) {
    const draft = (UI_TRANSLATIONS[lang]["ask.languageFallbackBanner"] ?? "").toLowerCase();
    ok(`4.ask.languageFallbackBanner/${lang} draft names "English" in its own vocabulary (${word}) — never silently omits which language the answer actually came back in`,
      draft.includes(word) && draft.includes("electioncanon"));
  }

  // studio.noAiImageDisclosure — must still say "AI" is not connected;
  // never drop the acronym (which would silently imply AI generation IS
  // available).
  for (const lang of ["ha", "ig", "yo", "pcm"]) {
    const draft = UI_TRANSLATIONS[lang]["studio.noAiImageDisclosure"] ?? "";
    ok(`5.studio.noAiImageDisclosure/${lang} draft still names "AI" explicitly`,
      draft.includes("AI"));
  }

  // Urhobo never drafts any of the 5 safety-gated keys at all (stays a
  // pure, documented English fallback — no invented disclosure wording
  // for a concept this project has no sourced Urhobo vocabulary for).
  ok("6. Urhobo defines NONE of the 5 safety-gated keys — an undrafted safety disclosure is never silently guessed",
    SAFETY_GATED_KEYS.every((k) => !(k in UI_TRANSLATIONS.urh)));
}

// ============================================================
console.log("\nG — ENGLISH ≠ TRANSLATION: representative strings actually differ, across every major section");
// ============================================================
{
  // One representative, genuinely-translated key per major UI area, for
  // each of the four languages this pass drafted in full (ha/ig/pcm/yo).
  // Proves the system didn't "pass" merely because six language codes
  // exist — these must be real, different strings.
  const REPRESENTATIVE = {
    "nav.home": "shared chrome / navigation",
    "home.whatNeedsAttention": "Home",
    "mobilize.fieldRoster": "Mobilization",
    "chat.coordinationRooms": "Chat",
    "comms.yourReview": "Communications",
    "canon.whenLabel": "Events/Canon",
    "electionDay.puAgentsHeading": "Election Operations",
    "readiness.claimsHeading": "Readiness",
    "ask.answerHeading": "Ask UI",
    "studio.languageHeading": "Motion/Creative Studio chrome",
  };
  for (const [key, area] of Object.entries(REPRESENTATIVE)) {
    for (const lang of ["ha", "ig", "pcm", "yo"]) {
      const enVal = UI_TRANSLATIONS.en[key];
      const langVal = UI_TRANSLATIONS[lang][key];
      ok(`1.${key}/${lang} (${area}) — English "${enVal}" differs from the ${lang} translation (a genuine translation exists, not a copy of English)`,
        typeof langVal === "string" && langVal !== enVal);
    }
  }
}

// ============================================================
console.log("\nH — URHOBO v0.1: a labeled PROPOSED/COMMUNITY-REVIEW tier, never silently presented as verified");
// ============================================================
{
  const urhKeys = Object.keys(UI_TRANSLATIONS.urh);
  ok("1. the single pre-existing source-verified key (studio.languageHeading) is still present and unchanged",
    "studio.languageHeading" in UI_TRANSLATIONS.urh && UI_TRANSLATIONS.urh["studio.languageHeading"] === "Éphérẹ");
  ok("2. every urh key genuinely differs from its English value (a real draft, not an accidental copy)",
    urhKeys.every((k) => UI_TRANSLATIONS.urh[k] !== UI_TRANSLATIONS.en[k]));
  ok("3. every key not drafted in urh is still reachable through INTENTIONAL_FALLBACKS' urh sentinel (ALL_UNDRAFTED) — the fallback mechanism is unchanged by the v0.1 pass",
    INTENTIONAL_FALLBACKS.urh === "ALL_UNDRAFTED" &&
    Array.from(usedKeys).filter((k) => !(k in UI_TRANSLATIONS.urh)).every((k) => isIntentionalFallback(k, "urh")));
  ok("4. t() for a representative still-undrafted key returns English (never undefined, never a crash)",
    t("mobilize.fieldRoster", "urh") === UI_TRANSLATIONS.en["mobilize.fieldRoster"]);

  // PROVENANCE — every drafted key must carry an honest status, and that
  // status must be one of exactly three values this project can actually
  // stand behind (see uiStrings.js's own URHOBO_PROPOSAL_STATUS header for
  // why the source material's original five-tier scheme was not carried
  // forward as-is).
  const VALID_STATUSES = ["SOURCE_VERIFIED", "UNVERIFIED", "UNVERIFIED_INTERNALLY_DISPUTED"];
  ok("5. every urh key has a provenance entry in URHOBO_PROPOSAL_STATUS, and vice versa — the two objects' key sets match exactly",
    urhKeys.every((k) => k in URHOBO_PROPOSAL_STATUS) &&
    Object.keys(URHOBO_PROPOSAL_STATUS).every((k) => k in UI_TRANSLATIONS.urh));
  ok("6. every provenance value is one of the three honest tiers — no lingering 'EXISTING_PROJECT_RESEARCH'/'SOURCE_VERIFIED' claim for a key this project could not independently confirm",
    Object.values(URHOBO_PROPOSAL_STATUS).every((v) => VALID_STATUSES.includes(v)));
  ok("7. exactly one key is SOURCE_VERIFIED (studio.languageHeading) — every other key is honestly UNVERIFIED or UNVERIFIED_INTERNALLY_DISPUTED, never upgraded without a real citation",
    Object.entries(URHOBO_PROPOSAL_STATUS).filter(([, v]) => v === "SOURCE_VERIFIED")
      .every(([k]) => k === "studio.languageHeading") &&
    Object.values(URHOBO_PROPOSAL_STATUS).filter((v) => v === "SOURCE_VERIFIED").length === 1);

  // Two keys the source material itself recommended NOT shipping — honored,
  // not overridden by this pass.
  ok("8. home.toneUrgent stays English — the source material's own author explicitly said they would not ship this term without Urhobo review",
    !("home.toneUrgent" in UI_TRANSLATIONS.urh) && isIntentionalFallback("home.toneUrgent", "urh"));
  ok("9. home.operationalStatus stays English — the source material's own author explicitly recommended keeping this technical status label in English",
    !("home.operationalStatus" in UI_TRANSLATIONS.urh) && isIntentionalFallback("home.operationalStatus", "urh"));

  // Safety gate is untouched by the v0.1 pass — re-verified here against the
  // actual new, larger urh object (section F above already proves this for
  // t()'s own behavior; this re-confirms no safety-gated key ever entered
  // the drafted object in the first place).
  ok("10. none of the 5 SAFETY_GATED_KEYS were added to urh by the v0.1 pass",
    SAFETY_GATED_KEYS.every((k) => !(k in UI_TRANSLATIONS.urh)));
}

// ============================================================
console.log("\nI — LANGUAGE IS PRESENTATION-ONLY: uiStrings.js itself cannot touch Canon/auth/scope");
// ============================================================
{
  const src = code("../src/pages/election/uiStrings.js");
  ok("1. uiStrings.js never imports the Supabase client",
    !/from\s+["'].*lib\/supabase\.js["']/.test(src));
  ok("2. uiStrings.js never references campaignId/userId/campaign_members/RLS/responsibility — it has no scope/identity concept at all",
    !/campaignId|userId|campaign_members|responsibility_slots/.test(src));
  ok("3. t()'s own signature takes only (key, lang, vars) — no campaign/session/scope parameter it could use to vary a Canon fact by language",
    /export function t\(key, lang = DEFAULT_LANGUAGE, vars = null\)/.test(src));
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);

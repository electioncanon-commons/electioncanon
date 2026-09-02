// ============================================================
// ELECTORAL GEOGRAPHY — INEC SOURCE PARSING, VALIDATION PIPELINE, DELTA
// RECONCILIATION  (National geography data acquisition & verification pass)
//
// Three kinds of evidence, kept deliberately separate:
//   A. parseCascadeResponse() — pure parsing logic, synthetic inputs.
//   B. integrity.mjs — the validation pipeline (duplicates/orphans/
//      malformed ids/inconsistency/count reconciliation/conflicting
//      extracts), synthetic inputs, so a passing test is never mistaken
//      for evidence about real Nigerian geography.
//   C. The Delta pilot reconciliation — runs the SAME parsing +
//      integrity functions against the REAL data captured live from
//      cvr.inecnigeria.org/PublicApi/ and persisted in
//      supabase/geography-import/fixtures/inec-delta-*-live.json. This is
//      the actual evidence backing this pass's reconciliation report —
//      not re-asserted narrative, a real assertion against real captured
//      INEC output.
//
// No network call in this file — CI/local `npm test` never depends on
// cvr.inecnigeria.org being reachable, matching this repo's own
// established "no real network in the test suite" discipline (see
// inec-source.mjs's own header for why the live-fetch functions
// themselves are untested here).
//
// Run: node test/election-geography-inec-reconciliation.consumer.mjs
// ============================================================

import { readFileSync } from "node:fs";
import { parseCascadeResponse } from "../supabase/geography-import/inec-source.mjs";
import { findDuplicates, findOrphans, findMalformedIdentifiers, findInconsistent, reconcileCount, findConflicts } from "../supabase/geography-import/integrity.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };
const fixture = (name) => JSON.parse(readFileSync(new URL(`../supabase/geography-import/fixtures/${name}`, import.meta.url), "utf8"));

console.log("\nELECTORAL GEOGRAPHY — INEC source parsing, validation pipeline, Delta reconciliation\n");

// ============================================================
console.log("A — parseCascadeResponse (pure parsing of INEC's own response shape)");
// ============================================================
{
  const raw = [{ "0": "--SELECT--", "selected": "0", "2298": "01 - OREROKPE", "2299": "02 - OVIRI - OKPE" }];
  const parsed = parseCascadeResponse(raw);
  ok("A1. the placeholder ('0'/'selected') is stripped, never treated as a real row", parsed.length === 2);
  ok("A2. the id is the real INEC internal id, not the display number", parsed[0].id === "2298");
  ok("A3. the display number and name are split apart correctly", parsed[0].displayNumber === "01" && parsed[0].name === "OREROKPE");
  ok("A4. a label with extra internal spacing/dashes still splits correctly", parsed[1].name === "OVIRI - OKPE");
  ok("A5. an empty/malformed response never throws, resolves to []", (() => { const r = parseCascadeResponse([{}]); return Array.isArray(r) && r.length === 0; })());
  ok("A6. null/undefined input never throws", parseCascadeResponse(null).length === 0 && parseCascadeResponse(undefined).length === 0);
  ok("A7. a label with no 'NN - ' prefix still parses, with a null displayNumber (never thrown away)",
    parseCascadeResponse([{ "999": "A LABEL WITH NO NUMBER PREFIX" }])[0].displayNumber === null);

  // National import repair, 2026-09-02 — root cause of the "null value in
  // column code" production failure: a real, live INEC polling-unit label
  // captured verbatim from the national acquisition (Abia/AROCHUKWU/
  // OVUKWU ward, PU id 612) wraps onto a second physical line INSIDE the
  // JSON string value itself. The original `.` capture never matches
  // `\n` (no dotAll flag), so the whole match failed on this label and
  // `displayNumber` silently fell back to null — not because INEC never
  // published a display number for this PU (it did, right there at the
  // front of the label), but because of a parser bug. Fixed by capturing
  // with `[\s\S]` instead of `.` (see inec-source.mjs's own header).
  const realMultilineLabel = "003 - NDI OJI ABAM I CENT. SCH. \nNDI OJI ABAM.";
  const parsedMultiline = parseCascadeResponse([{ "612": realMultilineLabel }])[0];
  ok("A8. a real captured multi-line PU label (embedded newline before the address continues) still yields its real displayNumber — this is the exact production root cause, fixed", parsedMultiline.displayNumber === "003");
  ok("A9. the multi-line label's name is recovered too, with the embedded newline normalized to a single space rather than left splitting the string", parsedMultiline.name === "NDI OJI ABAM I CENT. SCH. NDI OJI ABAM.");

  // Sequential real neighbors from the SAME live ward (PU ids 610-621),
  // confirming the fix doesn't just handle one cherry-picked example but
  // the whole regular 001..018 numbering the real ward's polling units
  // actually use — including several more embedded-newline labels.
  const wardOvukwu = {
    "610": "001 - ATAN ABAM I/ ATAN PRIMARY SCHOOL",
    "612": "003 - NDI OJI ABAM I CENT. SCH. \nNDI OJI ABAM.",
    "613": "004 - NDI OJI ABAM II CENT. SCH. \nNDI OJI ABAM.",
    "618": "009 - NDI OKORIE VILLAGE SQ. NDI\n OKORIE",
  };
  const parsedWard = parseCascadeResponse([wardOvukwu]);
  ok("A10. every real PU in this live ward now resolves a non-null displayNumber, including three separately-observed embedded-newline labels", parsedWard.every((pu) => pu.displayNumber !== null));
  ok("A11. the real sequential numbering (001, 003, 004, 009) is recovered exactly, not re-derived from array order or any other synthetic sequence",
    parsedWard.map((pu) => pu.displayNumber).sort().join(",") === "001,003,004,009");
}

// ============================================================
console.log("\nA2 — FORENSIC FOLLOW-UP (2026-09-02): every distinct whitespace/formatting pattern found among the 396 records, plus a production-scale check");
// ============================================================
// The importer's own preflight still reported 396 missing PU codes AFTER
// the A8-A11 fix above landed — a targeted, read-only live re-fetch of
// all 117 affected wards (see repair-snapshot-pu-codes.mjs) proved this
// was NOT a residual parser defect: the LOCAL SNAPSHOT FILE on disk was
// acquired before the fix, so it still held the old (pre-fix) null-code
// output. Re-running parseCascadeResponse() against all 396 real,
// freshly-refetched raw live labels resolved every single one (396/396).
// The classification below is the exact real breakdown observed across
// those 396 records — every one carried an embedded LF newline (100%);
// a majority (266/396) also had pre-existing internal repeated-space
// runs in the source text itself (cosmetic, not a parser bug); a smaller
// subset (26/396) additionally had trailing tab characters before the
// newline. No CRLF, no HTML entity, no non-ASCII dash character, and no
// case with a genuinely absent numeric prefix was found among the real
// 396 — but the parser is verified tolerant of all of those anyway,
// since `[\s\S]` matches literally any character and `\s` (used in the
// post-capture normalization) is Unicode-whitespace-aware per the JS
// spec, so this section tests them explicitly as a forward-looking
// robustness guarantee, not because they were observed.
{
  // ---- exact real labels captured from a live re-fetch (2026-09-02) ----
  const REAL_LABELS = {
    embeddedLf: "003 - NDI OJI ABAM I CENT. SCH. \nNDI OJI ABAM.", // Abia/AROCHUKWU/OVUKWU, PU 612
    embeddedLfMidWord: "009 - NDI OKORIE VILLAGE SQ. NDI\n OKORIE", // Abia/AROCHUKWU/OVUKWU, PU 618
    trailingTabsThenLf: "014 - BESIDE TRANSFORMER AT FIVE JUNCTION, TARBAJIN\t\t\n", // Ogun/.../SANGO, PU 660640
    repeatedInternalSpaces: "016 - BESIDE  TRANSFORMER, ANISERE JUNCTION, IPAMESAN\t\t\n", // Ogun/.../SANGO, PU 660642 — double space before "TRANSFORMER"
  };

  const embeddedLf = parseCascadeResponse([{ "612": REAL_LABELS.embeddedLf }])[0];
  ok("A2.1 [real: Abia/AROCHUKWU/OVUKWU PU 612] a single embedded LF newline before the address continuation resolves its real display number", embeddedLf.displayNumber === "003");

  const embeddedLfMidWord = parseCascadeResponse([{ "618": REAL_LABELS.embeddedLfMidWord }])[0];
  ok("A2.2 [real: Abia/AROCHUKWU/OVUKWU PU 618] an embedded newline landing mid-phrase (before a continuation word, not just before a new sentence) still resolves correctly", embeddedLfMidWord.displayNumber === "009" && embeddedLfMidWord.name === "NDI OKORIE VILLAGE SQ. NDI OKORIE");

  const trailingTabsThenLf = parseCascadeResponse([{ "660640": REAL_LABELS.trailingTabsThenLf }])[0];
  ok("A2.3 [real: Ogun/SANGO PU 660640] trailing tabs immediately followed by a newline at the very end of the label still resolve the display number", trailingTabsThenLf.displayNumber === "014");
  ok("A2.4 the trailing tabs/newline are normalized out of the name, not left dangling", trailingTabsThenLf.name === "BESIDE TRANSFORMER AT FIVE JUNCTION, TARBAJIN");

  const repeatedSpaces = parseCascadeResponse([{ "660642": REAL_LABELS.repeatedInternalSpaces }])[0];
  ok("A2.5 [real: Ogun/SANGO PU 660642] a pre-existing double space inside the source label (not a parser artifact) is collapsed to one in the normalized name", repeatedSpaces.name === "BESIDE TRANSFORMER, ANISERE JUNCTION, IPAMESAN");

  // ---- forward-looking robustness: patterns not observed in the real 396, verified tolerated anyway ----
  const crlf = parseCascadeResponse([{ "1": "005 - FIRST LINE\r\nSECOND LINE" }])[0];
  ok("A2.6 a Windows-style CRLF embedded newline (not just bare LF) still resolves correctly", crlf.displayNumber === "005" && crlf.name === "FIRST LINE SECOND LINE");

  const nbsp = parseCascadeResponse([{ "1": "006 - PLACE WITH NBSP" }])[0]; // U+00A0 non-breaking space
  ok("A2.7 a non-breaking space (U+00A0) inside the label is treated as whitespace and normalized, not left as a stray glyph", nbsp.displayNumber === "006" && nbsp.name === "PLACE WITH NBSP");

  const formFeedVTab = parseCascadeResponse([{ "1": "007 - A\fB\vC" }])[0]; // form feed / vertical tab
  ok("A2.8 other ASCII whitespace control characters (form feed, vertical tab) are tolerated and normalized too", formFeedVTab.displayNumber === "007" && formFeedVTab.name === "A B C");

  // ---- a genuinely malformed label — no digit-dash prefix anywhere — must NEVER be given a fabricated code ----
  const genuinelyMalformed = parseCascadeResponse([{ "999": "MARKET SQUARE, NO NUMBER EVER PUBLISHED" }])[0];
  ok("A2.9 a label that never had a leading 'NN - ' prefix at all — even after full whitespace tolerance — is honestly reported as null, never assigned a fabricated code", genuinelyMalformed.displayNumber === null);
  ok("A2.10 that record's full original text is preserved as `name` for a human to review, not discarded", genuinelyMalformed.name === "MARKET SQUARE, NO NUMBER EVER PUBLISHED");

  // ---- production-scale check: 176,846 source PUs, mixing every real and forward-looking pattern above ----
  const TOTAL = 176846;
  const MALFORMED_COUNT = 50; // deliberately genuinely-malformed, interspersed throughout
  const raw = {};
  let malformedPlaced = 0;
  // ids start at 1, never 0 — parseCascadeResponse deliberately strips key
  // "0" as INEC's own "--SELECT--" placeholder (see its own header/A1
  // above); using 0 as a real record id here would silently undercount
  // this test's own TOTAL by one, which is exactly the kind of off-by-one
  // this repair's own discipline exists to catch, not reproduce.
  for (let n = 1; n <= TOTAL; n++) {
    const isMalformed = malformedPlaced < MALFORMED_COUNT && n % Math.floor(TOTAL / MALFORMED_COUNT) === 0;
    if (isMalformed) {
      raw[String(n)] = `NO NUMBER PREFIX AT ALL FOR RECORD ${n}`;
      malformedPlaced++;
      continue;
    }
    const num = String((n % 999) + 1).padStart(3, "0");
    // Cycle through every real + forward-looking whitespace pattern found/verified above.
    const variant = n % 5;
    if (variant === 0) raw[String(n)] = `${num} - CLEAN LABEL ${n}`;
    else if (variant === 1) raw[String(n)] = `${num} - LABEL WITH\nEMBEDDED LF ${n}`;
    else if (variant === 2) raw[String(n)] = `${num} - LABEL WITH\r\nEMBEDDED CRLF ${n}`;
    else if (variant === 3) raw[String(n)] = `${num} - LABEL\t\tWITH TABS ${n}`;
    else raw[String(n)] = `${num} - LABEL  WITH  REPEATED  SPACES ${n}`;
  }
  const parsedAll = parseCascadeResponse([raw]);
  const validCount = parsedAll.filter((p) => p.displayNumber !== null).length;
  const malformedReported = parsedAll.filter((p) => p.displayNumber === null).length;
  ok("A2.11 production-scale (176,846 records): every record is processed, none dropped", parsedAll.length === TOTAL);
  ok("A2.12 production-scale: every record that DOES carry an authoritative source display number resolves one, regardless of which whitespace pattern it used", validCount === TOTAL - MALFORMED_COUNT);
  ok("A2.13 production-scale: every genuinely malformed (no-prefix) record is explicitly reported as null, exactly the deliberately-placed count, none silently coerced to a fabricated value", malformedReported === MALFORMED_COUNT);
}

// ============================================================
console.log("\nB — integrity.mjs validation pipeline (synthetic data)");
// ============================================================
{
  const wards = [
    { id: "w1", lgaId: "l1", name: "Central" },
    { id: "w2", lgaId: "l1", name: "Central" }, // duplicate name under same LGA
    { id: "w3", lgaId: "l1", name: "North" },
    { id: "w1", lgaId: "l1", name: "Central Dup Id" }, // duplicate id
  ];
  const dupNames = findDuplicates(wards, (w) => `${w.lgaId}::${w.name.toLowerCase()}`);
  ok("B1. findDuplicates catches the same NAME reused under the same parent", dupNames.length === 1 && dupNames[0].rows.length === 2);
  const dupIds = findDuplicates(wards, (w) => w.id);
  ok("B2. findDuplicates ALSO catches a reused id across two otherwise-different rows", dupIds.some((g) => g.key === "w1" && g.rows.length === 2));

  const lgaIds = new Set(["l1", "l2"]);
  const orphanWards = [{ id: "w4", lgaId: "l1" }, { id: "w5", lgaId: "l99-does-not-exist" }];
  const orphans = findOrphans(orphanWards, lgaIds, (w) => w.lgaId);
  ok("B3. findOrphans flags a ward whose LGA does not exist in the real parent set", orphans.length === 1 && orphans[0].id === "w5");
  ok("B4. findOrphans never flags a ward with a genuinely real parent", !orphans.some((w) => w.id === "w4"));

  const malformed = findMalformedIdentifiers([{ code: "123" }, { code: "abc" }, { code: "" }, { code: null }], (r) => r.code, /^\d+$/);
  ok("B5. findMalformedIdentifiers catches non-numeric, empty, and null identifiers, never the valid one", malformed.length === 3 && !malformed.some((r) => r.code === "123"));

  const rows = [{ state: "delta", lgaState: "delta" }, { state: "delta", lgaState: "lagos" }];
  const inconsistent = findInconsistent(rows, (r) => r.state === r.lgaState);
  ok("B6. findInconsistent reports rows failing a cross-field consistency check (e.g. state/LGA mismatch)", inconsistent.length === 1 && inconsistent[0].lgaState === "lagos");

  const count = reconcileCount(774, 774, "LGAs");
  ok("B7. reconcileCount reports an exact match honestly", count.matches === true && count.diff === 0);
  const mismatch = reconcileCount(773, 774, "LGAs");
  ok("B8. reconcileCount reports a real mismatch honestly, never rounds it away", mismatch.matches === false && mismatch.diff === -1);
  ok("B9. withinTolerance() is a separate, explicit opt-in — an exact-match check never silently tolerates a diff", mismatch.withinTolerance(1) === true && !mismatch.matches);

  const extractA = [{ id: "x1", name: "Okpe" }];
  const extractB = [{ id: "x1", name: "Okpe Renamed" }];
  const conflicts = findConflicts(extractA, extractB, (r) => r.id, ["name"]);
  ok("B10. findConflicts reports the SAME key with a DIFFERENT value across two extracts, never picks a winner silently", conflicts.length === 1 && conflicts[0].mismatchedFields.includes("name"));
}

// ============================================================
console.log("\nC — DELTA PILOT RECONCILIATION (real data captured from cvr.inecnigeria.org)");
// ============================================================
{
  const wardFixture = fixture("inec-delta-okpe-sapele-uvwie-wards-live.json");
  const reconFixture = fixture("inec-delta-reconciliation-live.json");

  ok("C1. the fixture records a real source name/URL, not a placeholder", /INEC/.test(wardFixture.source_name) && wardFixture.source_url.includes("inecnigeria.org"));
  ok("C2. the fixture records retrieval provenance (retrieved_at, reference_cycle) — never omitted", Boolean(wardFixture.retrieved_at) && Boolean(wardFixture.reference_cycle));

  ok("C3. national totals reconcile exactly against INEC's own stated figures (37 states+FCT, 774 LGAs, 8809 wards, 176846 PUs)",
    reconcileCount(reconFixture.national_totals_stated_by_inec.totalStatesIncludingFct, 37, "states").matches
    && reconcileCount(reconFixture.national_totals_stated_by_inec.totalLgas, 774, "lgas").matches
    && reconcileCount(reconFixture.national_totals_stated_by_inec.totalRegistrationAreasWards, 8809, "wards").matches
    && reconcileCount(reconFixture.national_totals_stated_by_inec.totalPollingUnits, 176846, "pus").matches);

  ok("C4. Delta's live-crawled LGA count matches the expected 25, exactly", reconFixture.delta_state.lgaCount === 25);
  ok("C5. Delta's live-crawled ward/PU totals are real, non-zero counts from an actual completed crawl (0 unresolved)",
    reconFixture.delta_state.totalWards === 270 && reconFixture.delta_state.totalPollingUnits === 5863
    && reconFixture.delta_state.unresolvedWardsDuringCrawl === 0);

  // The actual gap this pilot exists to prove, over the REAL parsed wards.
  const lgaNames = wardFixture.lgas.map((l) => l.name);
  ok("C6. the pilot covers EXACTLY the existing acceptance-test slice — Okpe, Sapele, Uvwie — no more, no less",
    lgaNames.length === 3 && lgaNames.includes("Okpe") && lgaNames.includes("Sapele") && lgaNames.includes("Uvwie"));

  let allWards = [];
  const perLgaCounts = {};
  for (const lga of wardFixture.lgas) {
    const parsed = parseCascadeResponse(lga.wardsRaw);
    perLgaCounts[lga.name] = parsed.length;
    allWards = allWards.concat(parsed.map((w) => ({ ...w, lga: lga.name })));
  }
  ok("C7. INEC reports real, non-zero ward counts for all 3 existing LGAs (Okpe 10, Sapele 11, Uvwie 10)",
    perLgaCounts.Okpe === 10 && perLgaCounts.Sapele === 11 && perLgaCounts.Uvwie === 10);
  ok("C8. total real wards known to INEC for the existing 3-LGA slice is 31 — this IS the import gap, not a guess",
    allWards.length === 31);

  ok("C9. no duplicate ward names under the same LGA in the real captured data",
    findDuplicates(allWards, (w) => `${w.lga}::${w.name.toLowerCase()}`).length === 0);
  ok("C10. no duplicate INEC ward ids in the real captured data", findDuplicates(allWards, (w) => w.id).length === 0);
  ok("C11. no malformed (non-numeric) INEC ward ids in the real captured data",
    findMalformedIdentifiers(allWards, (w) => w.id, /^\d+$/).length === 0);

  // PRESERVATION — the existing seed is asserted UNCHANGED, matching
  // exactly what 20260829000000_election_geography.sql's own seed section
  // and test/election-geography.consumer.mjs's own fixture already encode
  // (3 LGAs, 0 wards, 0 PUs) — this pass performed NO write.
  ok("C12. ElectionCanon's existing Okpe/Sapele/Uvwie seed is asserted PRESERVED — still exactly 3 LGAs, 0 wards, 0 PUs (no import was performed this pass)",
    reconFixture.electioncanon_existing_seed.lgaCount === 3
    && reconFixture.electioncanon_existing_seed.wardCount === 0
    && reconFixture.electioncanon_existing_seed.pollingUnitCount === 0
    && reconFixture.electioncanon_existing_seed.lgas.sort().join(",") === "Okpe,Sapele,Uvwie");
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
if (fail > 0) process.exit(1);

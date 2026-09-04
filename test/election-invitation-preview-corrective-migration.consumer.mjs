// ============================================================
// ELECTIONCANON 1.1.1 PHASE A — CORRECTIVE MIGRATION (auth.users source)
//
// Proves the corrective migration (20260904010000) fixes the real defect
// found by the forensic audit — the original, still-committed-but-never-
// applied 20260904000000 migration depends on public.profiles, which does
// not exist anywhere in the ElectionCanon Supabase project — WITHOUT
// silently drifting on anything else the original migration got right.
//
// This file does NOT modify or re-test election-invitation-identity.
// consumer.mjs (which still legitimately tests the ORIGINAL, still-
// committed 20260904000000 file's own content byte-for-byte — that file
// is untouched by this pass, per instruction). This is new, additive
// coverage for the new, separate corrective migration only.
//
// Part A proves the profiles->auth.users substitution itself, precisely.
// Part B proves the corrective migration's OWN contract on its own terms
// — campaign_name source, all four geography-resolution branches, and
// the required grants — WITHOUT comparing its text against the
// superseded original file. An earlier draft of this section instead
// diffed literal text blocks against 20260904000000; that made the test
// prove "these two files still agree" rather than "this migration is
// itself correct" — brittle to any future edit of either file's
// formatting, and not actually a claim about what this migration does.
// Every Part B assertion below is scoped to the corrective migration's
// real executable SQL, so it stays meaningful even if the original file
// is ever touched or removed.
// Part C re-confirms the same security/privacy/grant guarantees the
// original migration's own test already proved, now against the file
// that will actually be applied.
//
// Run: node test/election-invitation-preview-corrective-migration.consumer.mjs
// ============================================================

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };
const raw = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

console.log("\nELECTIONCANON 1.1.1 PHASE A — Corrective Migration (auth.users inviter source)\n");

const original = raw("../supabase/migrations/20260904000000_election_invitation_preview_inviter_context.sql");
const corrective = raw("../supabase/migrations/20260904010000_election_invitation_preview_auth_users_inviter_source.sql");
// The actual plpgsql function body only — excludes this migration's own
// header/inline prose, which legitimately NAMES public.profiles,
// raw_user_meta_data (as a bare word), and accept_campaign_invitation()
// to explain the fix and cite precedent. Checking those three facts
// against the WHOLE file (including that necessary prose) would produce
// false failures for a correctly-documented migration — the same class
// of mistake as testing "unrelated code" in reverse: this time comments
// that are supposed to be there would make a real assertion fail.
const correctiveBody = corrective.slice(corrective.indexOf("as $$"), corrective.indexOf("\n$$;"));

console.log("A. profiles -> auth.users substitution");
{
  ok("1. the corrective migration's actual SQL body never queries public.profiles (the header's own prose legitimately names it once, to explain why it's gone — checked against the function body only, not the whole file)",
     !/from\s+public\.profiles\b|join\s+public\.profiles\b/i.test(correctiveBody));
  ok("2. the ORIGINAL migration (still committed, untouched, never applied) still references public.profiles — proving this is genuinely a NEW file, not an edit of the old one",
     /public\.profiles/.test(original));
  ok("3. the corrective migration resolves the inviter name from auth.users, keyed by invited_by",
     /from auth\.users u where u\.id = v_inv\.invited_by/.test(corrective));
  ok("4. ONLY raw_user_meta_data ->> 'display_name' is selected — the exact jsonb-key-extraction operator, not the whole column",
     /u\.raw_user_meta_data\s*->>\s*'display_name'/.test(corrective));
  ok("5. auth.users.email is never read anywhere in this migration",
     !/u\.email\b/.test(corrective) && !/from auth\.users[\s\S]{0,120}\.email/.test(corrective));
  // Isolated to the one real executable statement (not the function body
  // as a whole) — this migration also carries a `--` SQL comment
  // explaining the fix inline, which (correctly) discusses
  // raw_user_meta_data in plain language too; SQL line comments aren't
  // stripped by this file's plain string handling, so the precise proof
  // is to look at just the real `select ... into v_inviter_name` line.
  const realQuery = correctiveBody.slice(
    correctiveBody.indexOf("select nullif(btrim(u.raw_user_meta_data"),
    correctiveBody.indexOf("where u.id = v_inv.invited_by;") + "where u.id = v_inv.invited_by;".length,
  );
  ok("6. the real query selects raw_user_meta_data exactly once, and only ever with ->>'display_name' immediately following it — never as a whole value",
     realQuery.length > 0 &&
     (realQuery.match(/raw_user_meta_data/g) ?? []).length === 1 &&
     (realQuery.match(/raw_user_meta_data\s*->>\s*'display_name'/g) ?? []).length === 1);
  ok("7. whitespace is trimmed (btrim) and an empty result becomes NULL (nullif), exactly matching the original migration's own normalization",
     /nullif\(btrim\(u\.raw_user_meta_data ->> 'display_name'\), ''\)/.test(corrective));
  ok("8. no email fallback exists anywhere near the inviter-name resolution (no coalesce/'||'-style fallback combining it with an email)",
     !/v_inviter_name[\s\S]{0,120}(email|coalesce)/i.test(corrective));
}

console.log("\nB. The corrective migration's own contract, proven on its own terms");
{
  ok("1. campaign_name is resolved from the real campaigns.name column, from exactly one source in the whole file — no second, no email-shaped, fallback",
     /select\s+c\.name\s+into\s+v_campaign_name\s+from\s+public\.campaigns\s+c\s+where\s+c\.id\s*=\s*v_inv\.campaign_id/i.test(corrective) &&
     (corrective.match(/into\s+v_campaign_name\b/gi) ?? []).length === 1);

  ok("2a. constituency-level geography resolves via geography_constituencies joined to geography_states on state_code",
     /from\s+public\.geography_constituencies\s+gc\s*\n\s*join\s+public\.geography_states\s+gs\s+on\s+gs\.code\s*=\s*gc\.state_code/i.test(corrective));
  ok("2b. lga-level geography resolves via geography_lgas joined to geography_states on state_code",
     /from\s+public\.geography_lgas\s+gl\s*\n\s*join\s+public\.geography_states\s+gs\s+on\s+gs\.code\s*=\s*gl\.state_code/i.test(corrective));
  ok("2c. ward-level geography resolves via geography_wards -> geography_lgas -> geography_states (the full ancestor chain, not just the leaf)",
     /from\s+public\.geography_wards\s+gw\s*\n\s*join\s+public\.geography_lgas\s+gl\s+on\s+gl\.id\s*=\s*gw\.lga_id\s*\n\s*join\s+public\.geography_states\s+gs\s+on\s+gs\.code\s*=\s*gl\.state_code/i.test(corrective));
  ok("2d. polling_unit-level geography resolves via geography_polling_units -> geography_wards -> geography_lgas -> geography_states (the full ancestor chain)",
     /from\s+public\.geography_polling_units\s+gp\s*\n\s*join\s+public\.geography_wards\s+gw\s+on\s+gw\.id\s*=\s*gp\.ward_id\s*\n\s*join\s+public\.geography_lgas\s+gl\s+on\s+gl\.id\s*=\s*gw\.lga_id\s*\n\s*join\s+public\.geography_states\s+gs\s+on\s+gs\.code\s*=\s*gl\.state_code/i.test(corrective));
  ok("2e. all four geography levels are branched correctly on v_inv.intended_level (constituency/lga/ward/polling_unit, if/elsif chain)",
     /if\s+v_inv\.intended_level\s*=\s*'constituency'/i.test(corrective) &&
     /elsif\s+v_inv\.intended_level\s*=\s*'lga'/i.test(corrective) &&
     /elsif\s+v_inv\.intended_level\s*=\s*'ward'/i.test(corrective) &&
     /elsif\s+v_inv\.intended_level\s*=\s*'polling_unit'/i.test(corrective));
  ok("2f. the resolved geography values actually reach the final return — not computed and discarded",
     /return query select[\s\S]{0,300}v_geo_name[\s\S]{0,100}v_state_name[\s\S]{0,100}v_lga_name[\s\S]{0,100}v_ward_name/i.test(corrective));

  ok("3. the corrective migration re-establishes, on its own terms, exactly the three required grant statements and no others",
     /revoke all on function public\.get_invitation_preview\(text\) from public;/.test(corrective) &&
     /grant execute on function public\.get_invitation_preview\(text\) to authenticated;/.test(corrective) &&
     /grant execute on function public\.get_invitation_preview\(text\) to anon;/.test(corrective) &&
     (corrective.match(/^(revoke|grant) /gim) ?? []).length === 3);

  // RETURNS TABLE / final SELECT column-count parity — a real structural
  // guard against the exact class of bug (mismatched column count) that
  // would make Postgres reject the function outright at CREATE time.
  const returnsTableCols = (corrective.match(/returns table \(([\s\S]*?)\n\)/)[1].match(/,/g) ?? []).length + 1;
  const selectList = corrective.slice(corrective.indexOf("return query select"), corrective.indexOf(";\nend;"));
  const selectCols = (selectList.match(/,/g) ?? []).length + 1;
  ok("4. RETURNS TABLE declares exactly 14 columns, and the final SELECT list supplies exactly 14 values, in matching count",
     returnsTableCols === 14 && selectCols === 14 && returnsTableCols === selectCols);
}

console.log("\nC. Security, privacy, and scope guarantees re-confirmed against the file that will actually be applied");
{
  ok("1. invited_email is never in RETURNS TABLE",
     !/returns table[\s\S]{0,600}invited_email/i.test(corrective));
  ok("2. invited_email is never in the final SELECT list",
     !/return query select[\s\S]{0,400}invited_email/i.test(corrective));
  ok("3. token is never returned (only received as the p_token input parameter)",
     !/returns table[\s\S]{0,600}\btoken text/i.test(corrective));
  ok("4. get_invitation_preview() is the only function this migration defines/replaces",
     (corrective.match(/create or replace function/gi) ?? []).length === 1 &&
     /create or replace function public\.get_invitation_preview/.test(corrective));
  ok("5. the three protected invitation functions are never DEFINED/REPLACED by this migration (the header's own prose legitimately names accept_campaign_invitation() once, to cite it as precedent — checked for actual DDL, not a bare name mention)",
     !/create (or replace )?function public\.(accept|create|revoke)_campaign_invitation/i.test(corrective));
  ok("6. no CREATE TABLE / ALTER TABLE / CREATE POLICY anywhere in this migration",
     !/create table|alter table|create policy/i.test(corrective));
  ok("7. the exact same grant shape is re-established: revoke from public, grant to authenticated, grant to anon",
     /revoke all on function public\.get_invitation_preview\(text\) from public/.test(corrective) &&
     /grant execute on function public\.get_invitation_preview\(text\) to authenticated/.test(corrective) &&
     /grant execute on function public\.get_invitation_preview\(text\) to anon/.test(corrective));
  ok("8. SECURITY DEFINER and the empty search_path lockdown are preserved, matching the original migration and accept_campaign_invitation()'s own established precedent",
     /security definer/i.test(corrective) && /set search_path = ''/.test(corrective));
  ok("9. the corrective migration's own timestamp (20260904010000) sorts after the superseded original (20260904000000)",
     "20260904010000" > "20260904000000");
}

console.log(`\n${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);

# Launch Engine — manual outreach import (no Google Takeout)

Google Takeout's phone verification is blocked for `sotinnovate@gmail.com`
and `admin@electioncanon.org`. This does not block recovering a record of
the outreach ElectionCanon has already sent — it only blocks downloading a
full mailbox archive. This doc describes the manual, row-by-row path
instead: copy facts out of Gmail's Sent folder by hand into a CSV, then
import that CSV through the admin tool that already exists for this exact
purpose.

**Nothing has been imported yet.** This doc is the template and the
procedure. No historical email has been loaded into any table by this
work — that only happens when a human runs Phase 5 below with a real file.

## 1. What already existed (verified against source, 2026-10-09)

- `launch_subscribers` / `launch_analytics_events`
  (`supabase/migrations/20260921000000_election_launch_distribution.sql`)
  are an anonymous, consent-based, double-opt-in public signup funnel —
  no named recipients, no response tracking, gated by `LAUNCH_ADMIN_SECRET`
  on the two admin-triggered functions (`launch-invite-audience`,
  `launch-send-campaign-email`). This is confirmed current, not assumed.
- A **separate, already-built** subsystem,
  "Outreach Activation 1.0" (`src/domains/outreach/`,
  `supabase/functions/outreach-admin/`,
  `src/pages/outreach/OutreachControlRoom.jsx`, mounted at
  `/launch/outreach`), already does exactly what Phase 2/4 of the outreach
  brief asks for: a named, admin-only tracker for institutional/media/
  civic-tech outreach, with a working CSV/JSON import, duplicate
  detection, and rejected-row reporting. It was implemented 2026-10-08 but
  was **uncommitted and undeployed** — no migration had been applied, no
  Edge Function deployed, no real data entered.
- **An import mechanism already existed.** Phase 2's proposed field list
  was therefore checked against it rather than inventing a new one. Two
  fields it asked for were genuinely missing — which account sent a given
  letter, and a pointer back to the source Gmail record — so this work
  added exactly those two columns (Phase 4 below), nothing else.

## 2. What was added, and why (the only schema change)

`outreach_contacts` gained two nullable/defaulted columns:

| column | type | default | why |
|---|---|---|---|
| `sender_account` | `text`, closed to `sotinnovate@gmail.com` / `admin@electioncanon.org` / `UNKNOWN` | `UNKNOWN` | The recovery spans two real mailboxes; nothing in the existing schema recorded which one sent a given letter. Closed vocabulary, not free text, because there are exactly two real accounts — same discipline as `sector`/`status`. |
| `source_record_ref` | `text`, ≤200 chars, nullable | `null` | A pointer back to the Gmail record (message id, permalink, or a plain-English search description), kept only when a human actually has one. Free text because Gmail's own UI doesn't always expose a stable id when copying by hand. |

Existing structures could not support this without the change: `sector`,
`status`, and every other column on `outreach_contacts` are closed
vocabularies for a different axis (industry, pipeline stage) — none of
them is "which of our two mailboxes sent this," and none is a free-text
back-reference. No other table or column was touched. The migration file
itself was edited in place (`20261008000000_election_outreach_activation.sql`)
rather than adding a second migration, because it had never been applied
to any database — there is nothing to be backwards-compatible with yet.

## 3. Subscriber consent and security boundaries (unchanged, verified)

- No code path in this change, or in the outreach subsystem generally,
  inserts a row into `launch_subscribers`. Historical outreach recipients
  are never auto-subscribed, and no confirmation timestamp, consent event,
  or unsubscribe history is fabricated for them.
- No code path writes to `launch_analytics_events`. A historical sent
  letter is not a product-analytics event and is never recorded as one.
- `outreach_contacts`/`outreach_status_changes`/`outreach_followups` carry
  **zero** client RLS policies (verified in the migration and by
  `test/election-outreach-launch-separation.consumer.mjs`'s source scan).
  Every read/write goes through the `outreach-admin` Edge Function, which
  requires the `OUTREACH_ADMIN_SECRET` bearer token checked **before** the
  request body is even read. `LAUNCH_ADMIN_SECRET` is untouched and is a
  different secret for a different function.
- No email provider is reachable from this subsystem. There is no
  `fetch()` call anywhere in `outreach-admin/index.ts`,
  `src/domains/outreach/*.js`, or `src/domains/outreach/write.js` —
  enforced by source-scan tests, not just a design note. Nothing here can
  send anything to anyone.

## 4. CSV template

See [`docs/outreach/IMPORT-TEMPLATE.csv`](outreach/IMPORT-TEMPLATE.csv).
Columns, all optional except `organization` and `email`:

```
organization, recipient, email, sector, country, campaign, subject,
letter_version, date_sent, known_status, known_response,
sender_account, source_record_ref, notes
```

- `organization` / `email` — required. `email` must look like an email
  address or the row is rejected.
- `sector` — one of `media`, `civic_tech`, `democracy_election_org`,
  `development_org`, `open_source_dev`, `institutional_partner`, `other`.
  An unrecognized value falls back to `other` rather than rejecting the
  row (sector is informational here, not an identity field).
- `date_sent` — any string `Date.parse` understands (e.g. `2026-09-15`).
  Leave blank if you genuinely don't know when it was sent.
- `known_status` / `known_response` — plain-English words like `sent`,
  `responded`, `no response`, `declined`, `conversation`, `demo`. An
  unrecognized word is kept verbatim in the record's notes rather than
  silently mapped to the nearest guess.
- `sender_account` — `sotinnovate@gmail.com` or `admin@electioncanon.org`.
  Leave blank if you don't know; it defaults to `UNKNOWN`, never a guess.
- `source_record_ref` — anything that would help a human relocate the
  original email later: a Gmail message id, a permalink, or a short
  description like `"Sent folder, search: to:jane@example.org 2026-09"`.
- `notes` — free text, carried forward verbatim. Use this for anything a
  richer source tracker has that doesn't map to a dedicated column above
  (a website, a one-line pitch, a priority tier, a verification note) —
  nothing is dropped, it just isn't split into structured fields.

**The one inference the importer makes:** a row with a `date_sent` but no
recognizable `known_status` becomes `status: SENT`, not the usual `DRAFT`
default — because "sent on this date" is literally what the row says.
Nothing else is inferred. Everything else you leave blank stays at its
honest `UNKNOWN`/null default.

## 5. Exact manual steps

**A. Pull the facts out of Gmail by hand** (per account —
`sotinnovate@gmail.com` and `admin@electioncanon.org` — since Takeout is
blocked, this is a manual review of the Sent folder):

1. Open Gmail, go to **Sent**.
2. Search `to:*` scoped to the outreach window (e.g.
   `after:2026/08/01 before:2026/10/01`) to limit the review to the
   launch period.
3. For each outreach email (skip personal/internal mail), copy into a row
   of the CSV: the recipient's organization and email, the subject line,
   the date sent, and — only if you actually know it — the sector, the
   campaign/wave name, and any reply you recall receiving. Leave every
   other field blank.
4. Set `sender_account` to whichever of the two addresses you're reviewing.
5. If you want a way back to the original thread later, paste its Gmail
   permalink (or a short search description) into `source_record_ref`.
6. Repeat for the second account. Do not guess at a recipient, a date, or
   a response you don't actually remember — a blank field is honest; a
   fabricated one is not, and the importer treats blanks correctly while
   it cannot tell a guess from a fact.

**B. Import the CSV:**

1. Deploy the Edge Function and set its secret (first time only — see
   §6): `supabase functions deploy outreach-admin` and set
   `OUTREACH_ADMIN_SECRET` as a function secret. Apply the migration:
   `supabase db push` (or run the SQL file directly against the project).
2. Visit `/launch/outreach` in the app, enter the `OUTREACH_ADMIN_SECRET`.
3. Open the **Import** tab, paste the CSV contents, click **Preview**.
4. Review the counts — new / duplicate-in-batch / duplicate-of-existing /
   invalid — and read any per-row error shown for invalid rows before
   importing. Fix the source CSV and re-paste if anything looks wrong;
   nothing is written until you click **Import**.
5. Click **Import N new contacts**. The result line reports
   imported/duplicate/invalid/failed counts — the same shape
   `importOutreachContacts()` returns, nothing summarized away.

## 6. Deployment prerequisites (not done by this change)

Per explicit instruction, nothing was deployed or applied by this work:

- The migration (with the two new columns) has not been applied to any
  live database.
- The `outreach-admin` Edge Function has not been deployed.
- `OUTREACH_ADMIN_SECRET` has not been set anywhere.
- No real historical letter has been imported — only the template above
  and the test fixtures in `test/election-outreach-import.consumer.mjs`
  exist.

## 7. Tests and results (run 2026-10-09)

All pre-existing outreach tests plus the new assertions for
`sender_account`/`source_record_ref` pass:

```
election-outreach-model.consumer.mjs            41/41
election-outreach-import.consumer.mjs            37/37
election-outreach-admin-function.consumer.mjs    36/36
election-outreach-control-room.consumer.mjs      21/21
election-outreach-launch-separation.consumer.mjs 33/33
election-outreach-followup.consumer.mjs          21/21
election-outreach-assets.consumer.mjs            20/20
election-outreach-learning.consumer.mjs          14/14
```

Covered directly: a valid CSV import (new rows accepted), a malformed row
(missing organization, bad email, out-of-vocabulary sector/sourceOfTruth/
senderAccount — each rejected with a field-naming error), duplicate
handling (same email within one batch, and against contacts already in
the table — both flagged, neither silently merged), unauthorized access
(`outreach-admin` refuses any request without the exact
`OUTREACH_ADMIN_SECRET` bearer token, checked before the body is parsed),
and subscriber-consent protection (source-scan proof that no outreach code
path references `launch_subscribers`, `launch_analytics_events`, or
`LAUNCH_ADMIN_SECRET`, in either direction).

`npm test` (92 suites) and `npm run build` are both clean after this
change.

## 8. Dry-run preview against `04_EOC_SUPER_TRACKER.xlsx` (2026-10-09)

**No database write occurred.** This is a local, pure-function preview
run against the actual `normalizeImportRow()`/`detectDuplicates()` from
`src/domains/outreach/import.js` — the same code the admin UI's Import
tab calls — over the real workbook, with no network call and no
`import_contacts` request sent anywhere. Nothing has been imported.

The workbook has four worksheets, handled as follows:

| sheet | rows | handling |
|---|---|---|
| **SUPER TRACKER** | 40 | The one sheet that maps to `outreach_contacts` rows. See column mapping and results below. |
| **SEND PLAN** | 3 | Wave-level metadata (date/wave/target-count/objective), not per-contact — there is no row to import. Preserved as reference only (reproduced below); informed the `campaign` value assigned to each tracker row by `Category` (`Observation`→`wave_1_observation`, `Industry`→`wave_2_industry`, `Development`/`Corporate`→`wave_3_development_corporate`), cross-checked against its own stated counts (12/10/18, matching the tracker's actual 12/10/18 Observation/Industry/Development+Corporate split). |
| **CONTACT SOURCE NOTES** | 40 | Same 40 organizations, same order, as SUPER TRACKER — a second, genuinely different verification note per row (confirmed by direct comparison; not a duplicate of SUPER TRACKER's own `Verification Notes` column). Folded into each contact's `notes` field alongside the tracker's own verification note, rather than imported as its own set of rows. |
| **PREVIOUS OUTREACH** | 9 | NOT imported as `outreach_contacts` rows. These are organizations contacted under a **different, unrelated** earlier campaign (workforce-development outreach, an existing due-diligence thread) — importing them here would misrepresent an unrelated email as an EOC outreach letter. Kept as the reconciliation reference reproduced below; one entry (`AfriLabs`) also appears in SUPER TRACKER — see the conflict flagged below. |

**Column mapping used** (SUPER TRACKER → import schema): `Organisation`→
`organization`, `Contact Person / Route`→`recipient`, `Email / Route`→
`email`, `Category`→`sector` (recommended mapping below — informational
only, an unmapped value safely falls back to `other`, never rejected),
`Category`→`campaign` (per the wave mapping above), `Status`→
`known_status` (`"READY"` is not a recognized pipeline-status synonym, so
it is preserved verbatim in `notes` and the contact correctly stays
`DRAFT` — never promoted to `SENT`), `Response`→`known_response` (empty
on every row), `Date Sent`→`date_sent` (**never** `Date Planned` — `Date
Planned` is folded into `notes` as context instead, so a planned-but-
not-yet-sent letter can never be inferred as sent). `Website`,
`Proposition`, `Priority`, `Next Action`, `Follow-up Date`, `Meeting
Date`, `Contribution / Partnership Type`, and both sheets' verification
notes are concatenated into `notes` — nothing is silently dropped.

Recommended `Category`→`sector` mapping (a judgment call, not yet
confirmed by a human — flagging rather than deciding unilaterally):
`Observation`→`democracy_election_org`, `Development`→`development_org`,
`Industry`→`other`, `Corporate`→`other`. No `sender_account` or
`source_record_ref` was set for any row — nothing in this wave has been
sent from either mailbox yet, so `UNKNOWN`/`null` is the honest default.

**Results:**

- **36 of 40 rows are valid** and would be accepted by the importer.
- **4 rows are rejected**, all for the same reason — `Email / Route`
  is not an email address (it's an instruction: `"Official contact
  form"`, a phone number, or a named business-contact route) —
  `outreach_contacts` requires a real email address by design, since it
  models direct email outreach. These are not a bug; they need either a
  real email address researched before import, or a product decision
  (out of scope here) about whether non-email contact routes belong in
  this schema at all.
- **Classified against the live table (currently empty — nothing has
  ever been imported): 36 new, 0 duplicate-in-batch, 0
  duplicate-of-existing.**
- **Idempotency verified**: re-running the identical 36-row batch against
  a simulated post-import table (the 36 rows the first run would have
  inserted) reclassifies all 36 as `duplicate_existing` and 0 as `new` —
  a repeat import is a safe no-op, not a double-insert.
- **One cross-sheet conflict flagged, not auto-resolved:** `AfriLabs`
  appears in SUPER TRACKER as a fresh EOC send (Category: Industry) and
  in PREVIOUS OUTREACH as `SENT` under a different earlier thread, with
  the explicit instruction *"Use a new EOC thread only if appropriate;
  do not duplicate the earlier introduction."* A human should decide
  whether to proceed, reword, or skip this one row before any real
  import — the importer itself has no way to know these are the same
  organization across two different purposes.

No row from this workbook has been written to any table. Running the
real import (Section 5 above) against this data is a decision for the
operator, not performed here.

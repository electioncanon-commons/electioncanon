# Urhobo NO_DEFENSIBLE_PROPOSAL Worksheet — concept-level gap analysis, no sentences

**This is not a translation.** It contains zero composed Urhobo sentences. It exists for
exactly one reason: to show a future reviewer/translator which individual concepts in the 7
`NO_DEFENSIBLE_PROPOSAL` English paragraphs already have *some* Urhobo word on record
anywhere in this project — dictionary-sourced or not — and which have genuinely nothing,
so a human starts from a worksheet instead of a blank page. This mirrors the exact method
`src/os/studio/urhobo/questions.js` already uses for question patterns (`spine`, attested
pieces only, `urhobo: null` for the sentence itself).

## Why this exists, and why it stops here

A request was made to attempt full Urhobo prose for these 7 paragraphs. That was declined.
Reason: these are the one tier of this pack where the original research itself (the
structured JSON this pass drew from) explicitly concluded translation was **not
defensible** — citing "forcing translation risks semantic corruption" for the
architectural/marketing paragraphs, and "safety-critical... requires formal legal/
linguistic approval" for the non-affiliation disclaimer specifically. Composing fluent
Urhobo paragraphs from a ~40-word attested vocabulary, as a non-speaker, for a live
election product, in a language whose own speakers describe real dialect variation
("different shades"), is precisely the fabrication this project's own discipline
(`lexicon.js`, `technical.js`, `questions.js`) exists to prevent. This worksheet goes no
further than cataloguing existing words. **`uiStrings.js` is unchanged by this document —
all 7 keys remain `NO_DEFENSIBLE_PROPOSAL` and fall back to English, exactly as before.**

## How to read each table

- **DICTIONARY-ATTESTED** — the word appears in Ukere's *Urhobo–English Dictionary* or the
  UCLA 1984 word list, cited directly in `lexicon.js`/`technical.js`/`phrases.js`. This is
  the same confidence tier as `SOURCE_VERIFIED`/`CONTEXTUAL` elsewhere in this project.
- **ALREADY PROPOSED ELSEWHERE (UNVERIFIED)** — not in any dictionary this project has
  checked, but already shipped somewhere else in `uiStrings.js`'s `urh` object under the
  `UNVERIFIED` tier for a matching concept. Reusing it here would be *consistent* with the
  existing pack, not independent evidence it is correct Urhobo.
  **This source listing is correct as of this document's own writing; it is not re-verified
  on every future edit of `uiStrings.js` — if the cited key's value changes, re-check it.**
- **NO ATTESTED OR PROPOSED WORD** — genuinely nothing on record anywhere in this codebase
  for that concept. The honest gap.

---

## 1. `landing.heroBody`

> "ElectionCanon replaces fragmented campaign coordination — scattered chats, calls, and
> spreadsheets — with one accountable operational system: territory, organisation,
> responsibility, readiness, and coordination, all built on a single event-sourced record
> that every screen reads from."

| Concept | Status | Word / citation |
|---|---|---|
| replaces | NO ATTESTED OR PROPOSED WORD | — |
| fragmented | NO ATTESTED OR PROPOSED WORD | — |
| campaign | ALREADY PROPOSED ELSEWHERE (UNVERIFIED) | `egbe-vwo` — `urh["landing.ctaStart"]` |
| coordination | ALREADY PROPOSED ELSEWHERE (UNVERIFIED) | `usuerin-eghwẹro` — `urh["nav.chat"]` (same word also stands for the "Chat" nav label — a genuine ambiguity a reviewer should flag, not two independent attestations) |
| scattered | ALREADY PROPOSED ELSEWHERE (UNVERIFIED) | `ghwariẹ` — `urh["landing.problemHeading"]`, `urh["landing.problemTag.volunteers"]` |
| chats (informal messaging) | NO ATTESTED OR PROPOSED WORD | distinct from "coordination" above — no dedicated word for informal chat/conversation |
| calls (phone) | ALREADY PROPOSED ELSEWHERE (UNVERIFIED) | `Isio-itẹlifoni` — `urh["landing.problemTag.calls"]` (`itẹlifoni` is a loanword) |
| spreadsheets | ALREADY PROPOSED ELSEWHERE (UNVERIFIED), marked UNCERTAIN/LOW confidence in its own source | `Ibeba ẹchate` — `urh["landing.problemTag.spreadsheets"]` |
| accountable | NO ATTESTED OR PROPOSED WORD | not composed anywhere in the shipped pack |
| operational system | ALREADY PROPOSED ELSEWHERE (UNVERIFIED) | `Ekpoko` (system) — `urh["landing.heroHeadline"]`; `Oru-iruo` (operational) — `urh["landing.categoryOperational"]` |
| territory | ALREADY PROPOSED ELSEWHERE (UNVERIFIED), half dictionary-grounded | `Asa-ẹserovwo` — `urh["landing.step.territory"]`. `asa` (place) IS dictionary-attested (`lexicon.js` CONTENT, Ukere: `asa1 n. place`, SOURCE_VERIFIED); `ẹserovwo` (election) is not. |
| organisation | ALREADY PROPOSED ELSEWHERE (UNVERIFIED) | `Ukoko-iruo` — `urh["landing.step.organisation"]` |
| responsibility | ALREADY PROPOSED ELSEWHERE (UNVERIFIED) | `Iruo-ẹso` — `urh["landing.step.responsibility"]` |
| readiness | ALREADY PROPOSED ELSEWHERE (UNVERIFIED), one of the 7 `UNVERIFIED_INTERNALLY_DISPUTED` keys | `Ẹmwana` — `urh["nav.readiness"]` |
| built | ALREADY PROPOSED ELSEWHERE (UNVERIFIED), different sense (imperative "create/build a campaign" vs. passive "built on") | `Ma` — `urh["landing.startHeading"]` |
| single / one | ALREADY PROPOSED ELSEWHERE (UNVERIFIED) | `ọvo` — `urh["landing.workspaceHeading"]` |
| event-sourced (compound concept) | NO ATTESTED OR PROPOSED WORD | `Ẹfiamu` (event) exists alone (`urh["landing.chainEvent"]`) but the compound technical concept does not |
| record | ALREADY PROPOSED ELSEWHERE (UNVERIFIED); note a different dictionary word exists for the adjacent concept "evidence" | `Ekere` — `urh["landing.chainRecord"]`. (Not the same as `úseri` n. proof/evidence, SOURCE_VERIFIED, `lexicon.js` CONTENT — a reviewer should decide if that's a better fit here.) |
| screen | ALREADY PROPOSED ELSEWHERE (UNVERIFIED) | `eku` (rooms) — `urh["landing.architectureHeading"]` ("Eku e se" = "Rooms read") |
| reads | DICTIONARY-ATTESTED | `se` — Ukere: `se1 v.t read` (`lexicon.js` CONTENT, SOURCE_VERIFIED). Already reused in `urh["landing.architectureHeading"]`. |

## 2. `landing.problemBody`

> "None of this means a campaign isn't working hard — it means the work has nowhere shared
> to live. ElectionCanon is the infrastructure that brings it together: one record everyone
> in the campaign can trust, instead of a dozen scattered ones nobody fully sees."

| Concept | Status | Word / citation |
|---|---|---|
| means / meaning | NO ATTESTED OR PROPOSED WORD | — |
| campaign | ALREADY PROPOSED ELSEWHERE (UNVERIFIED) | `egbe-vwo` (see above) |
| working hard | NO ATTESTED OR PROPOSED WORD | `íruéru` (activity, SOURCE_VERIFIED) and `íruorugbóbọ` (manual work, rejected as too narrow in `lexicon.js`) are adjacent but neither covers this sense |
| nowhere / shared / live (verb) | NO ATTESTED OR PROPOSED WORD | — |
| infrastructure | NO ATTESTED OR PROPOSED WORD | `Ekpoko` is sometimes used loosely for "system/machine" (`urh["landing.openSourceHeading"]`) but "infrastructure" specifically is unattested |
| brings together / connects | ALREADY PROPOSED ELSEWHERE (UNVERIFIED) | `ku ... gba` — `urh["landing.differenceHeading"]` |
| record | ALREADY PROPOSED ELSEWHERE (UNVERIFIED) | `Ekere` (see above) |
| everyone | ALREADY PROPOSED ELSEWHERE (UNVERIFIED), built from a dictionary-attested root | `Kohwo kohwo` — `urh["landing.hierarchyHeading"]`, reduplicating `ohwó` (person — Ukere: `ohwó n. person`, SOURCE_VERIFIED, corroborated by UCLA 1984 #27) |
| trust | NO ATTESTED OR PROPOSED WORD | — |
| dozen | NO ATTESTED OR PROPOSED WORD | — |
| scattered | ALREADY PROPOSED ELSEWHERE (UNVERIFIED) | `ghwariẹ` (see above) |
| nobody | NO ATTESTED OR PROPOSED WORD | — |
| sees / seen | NO ATTESTED OR PROPOSED WORD IN THIS SENSE | `mrẹ` (see, Ukere: `mrẹ v.t see`, SOURCE_VERIFIED, `lexicon.js` CONTENT) exists but has never been reused anywhere in the shipped pack |

## 3. `landing.canonBody`

> "ElectionCanon calls this record the Canon — a single, tenant-isolated history that every
> screen reads from and every action writes to. Assign a ward. Report readiness. Send a
> message. Each becomes a permanent, attributed fact, not a claim that quietly disappears
> into someone's phone."

| Concept | Status | Word / citation |
|---|---|---|
| calls (names it) | NO ATTESTED OR PROPOSED WORD | `ta` (talk/say, SOURCE_VERIFIED) is a different sense (speaking, not naming/designating) |
| record | ALREADY PROPOSED ELSEWHERE (UNVERIFIED) | `Ekere` (see above) |
| Canon | Proper noun | Kept as "Canon" in every language already — not a translation target |
| single | ALREADY PROPOSED ELSEWHERE (UNVERIFIED) | `ọvo` (see above) |
| tenant-isolated | NO ATTESTED OR PROPOSED WORD | SaaS-specific technical term, no realistic path from this vocabulary |
| history | NO ATTESTED OR PROPOSED WORD | explicitly listed in `lexicon.js`'s own `UNSOURCED` registry — searched, no dictionary match found |
| screen / reads | see row 1 | `eku` / `se` |
| action | ALREADY PROPOSED ELSEWHERE (UNVERIFIED) | `Iruo` — `urh["landing.chainAction"]` |
| writes | ALREADY PROPOSED ELSEWHERE (UNVERIFIED) | `kerẹ` — `urh["landing.architectureHeading"]` ("Ẹfiamu kerẹ" = "Events write") |
| assign | NO ATTESTED OR PROPOSED WORD | — |
| ward | NO ATTESTED OR PROPOSED WORD | genuinely never translated anywhere in this pack — geography labels reference wards contextually but no `urh` key exists for the bare word |
| report (verb) | NO ATTESTED OR PROPOSED WORD | — |
| readiness | ALREADY PROPOSED ELSEWHERE (UNVERIFIED) | `Ẹmwana` (see above) |
| send | NO ATTESTED OR PROPOSED WORD | — |
| message | DICTIONARY-ATTESTED, never yet used in the shipped pack | `óvuẹ` — Ukere: `óvuẹ n. message` (`lexicon.js` BASIC, SOURCE_VERIFIED) |
| becomes / permanent / attributed / fact / claim / quietly / disappears | NO ATTESTED OR PROPOSED WORD | none of these seven concepts has any word on record anywhere in this codebase |
| phone | NO ATTESTED OR PROPOSED WORD standalone | `itẹlifoni` exists only inside the compound `Isio-itẹlifoni` ("phone calls") |

## 4. `landing.openSourceBody1`

> "ElectionCanon is licensed under AGPL-3.0 — read it, run it locally, question it, and
> improve it. Election infrastructure should be inspectable by the people who rely on it,
> not a black box."

| Concept | Status | Word / citation |
|---|---|---|
| licensed | NO ATTESTED OR PROPOSED WORD | — |
| AGPL-3.0 | Legal proper noun | Kept verbatim in every language already (e.g. `urh["landing.footerCopyright"]`) — never translated |
| run (execute) / locally | NO ATTESTED OR PROPOSED WORD | distinct from `ruẹ` ("do/perform," used pervasively as in "ruẹ iruo" = "does work") — "execute code" is a different, more technical sense |
| question (verb, interrogate) | PARTIAL — different part of speech | `ónánó`/`onọ` = "question" exists only as a NOUN (Ukere, SOURCE_VERIFIED, `lexicon.js` BASIC) — not attested as a verb meaning "to question/interrogate [the system]" |
| improve | NO ATTESTED OR PROPOSED WORD | — |
| election infrastructure | see "infrastructure" above; "election" = `ẹserovwo` ALREADY PROPOSED ELSEWHERE (UNVERIFIED) | — |
| inspectable | NO ATTESTED OR PROPOSED WORD | — |
| people | DICTIONARY-ATTESTED root, plural form composed elsewhere | `ohwó` (person, SOURCE_VERIFIED); `Ihwo-evwovwe` (volunteers) — `urh["landing.audience.volunteers"]`, ALREADY PROPOSED ELSEWHERE for a general people-plural sense |
| rely | NO ATTESTED OR PROPOSED WORD | — |
| black box (idiom) | NO ATTESTED OR PROPOSED WORD | no realistic literal path for this English idiom |

## 5. `landing.openSourceBody2`

> "Build with us. An independent, ElectionCanon-controlled public repository is now live.
> Read it, run it locally, question it, and contribute as the project develops."

| Concept | Status | Word / citation |
|---|---|---|
| build (imperative) | ALREADY PROPOSED ELSEWHERE (UNVERIFIED) | `Ma` — `urh["landing.startHeading"]` |
| independent / controlled / public (adjective) / repository / live (adjective) / contribute (this specific sense) / develops | NO ATTESTED OR PROPOSED WORD | none of these seven has any word on record. Note: `árhóghọ` (contribution, Ukere SOURCE_VERIFIED, `lexicon.js` CONTENT) exists for the NOUN "a contribution" but the project's own note on it says ForgeOS gives the word a precise relational meaning distinct from this everyday sense — flagged there as needing review before reuse, so not treated as a clean match here either. `rhie fia` ("opened/made public," `urh["landing.openSourceKicker"]`) is a verb phrase for "has been opened," not the adjective "public" |
| project | NO ATTESTED OR PROPOSED WORD | `technical.js` lists "project" explicitly with `candidate: null` — confirmed searched, no dictionary word found |
| question / run / locally | see row 4 | — |

## 6. `landing.nonAffiliation`

> "ElectionCanon does not run for or against any party or candidate, and its use implies no
> endorsement by, or affiliation with, any electoral authority or government body."

| Concept | Status | Word / citation |
|---|---|---|
| does not run for/against (political sense) | NO ATTESTED OR PROPOSED WORD | — |
| party (political) | NO ATTESTED OR PROPOSED WORD | — |
| candidate | ALREADY PROPOSED ELSEWHERE (UNVERIFIED), marked UNCERTAIN/LOW confidence in its own source | `ihwo-ẹphẹn` — `urh["landing.audience.candidate"]` |
| implies / endorsement / affiliation | NO ATTESTED OR PROPOSED WORD | none of these three has any word on record anywhere in this codebase |
| electoral authority | NO ATTESTED OR PROPOSED WORD | distinct from `ẹserovwo` (election) itself |
| government body | NO ATTESTED OR PROPOSED WORD | — |

**This row set is the shortest of the 7 — not because it is easy, but because almost none
of its load-bearing legal vocabulary (endorsement, affiliation, electoral authority,
political party, government body) exists anywhere in this project's sourced research. A
mistranslation here would misstate ElectionCanon's political neutrality in an election
product — treat this as the single highest-priority item for a native legal/linguistic
reviewer, not the easiest to fill in from the table above.**

## 7. `landing.startBody`

> "Create an account, establish your campaign, select your election, office, and
> constituency, and begin building your organisation — from campaign command down to the
> polling unit."

| Concept | Status | Word / citation |
|---|---|---|
| create | ALREADY PROPOSED ELSEWHERE (UNVERIFIED) | `Ma` (see above) |
| account | NO ATTESTED OR PROPOSED WORD | — |
| establish | NO ATTESTED OR PROPOSED WORD | — |
| campaign | ALREADY PROPOSED ELSEWHERE (UNVERIFIED) | `egbe-vwo` |
| select | NO ATTESTED OR PROPOSED WORD | — |
| election | ALREADY PROPOSED ELSEWHERE (UNVERIFIED) | `Ẹserovwo` — `urh["landing.step.election"]` |
| office | ALREADY PROPOSED ELSEWHERE (UNVERIFIED) | `Unue-iruo` — `urh["territory.office"]` |
| constituency | ALREADY PROPOSED ELSEWHERE (UNVERIFIED), marked UNCERTAIN/LOW confidence in its own source | `Asa-ẹphẹn ẹserovwo` — `urh["territory.constituency"]` |
| begin | NO ATTESTED OR PROPOSED WORD, distinct note | `Tonnọ` (`urh["landing.startKicker"]`) was originally cited as "EXISTING_PROJECT_RESEARCH" from `lexicon.js`, but the provenance audit already committed to this repo (`docs/multilingual/URHOBO-UI-PROPOSED-v0.1.md`) found no "start" entry anywhere in `lexicon.js` — that citation did not hold up, and `Tonnọ`'s status was corrected to `UNVERIFIED`. So it belongs in the "already proposed, unsourced" tier, not dictionary-attested. |
| building (organisation) | ALREADY PROPOSED ELSEWHERE (UNVERIFIED) | `Ukoko-iruo` (see above) |
| campaign command | ALREADY PROPOSED ELSEWHERE (UNVERIFIED) | `Uvo-Iruo Egbe-vwo` — `urh["landing.hierarchy.command"]` |
| polling unit | ALREADY PROPOSED ELSEWHERE (UNVERIFIED) | `Asoya Ẹserovwo` — `urh["territory.office"]`/hierarchy labels |

---

## Summary for a reviewer deciding where to start

Counting unique concepts across all 7 paragraphs (not double-counting repeats like
"campaign," "record," "readiness"):

- **2 concepts have a true dictionary citation**: `se` (reads) and `óvuẹ` (message) — both
  Ukere `SOURCE_VERIFIED`, and notably `óvuẹ` has never even been used in the shipped pack
  yet despite being available.
- **~25 concepts reuse a word already shipped elsewhere in `urh`** — consistent with the
  existing pack, but none of those words are independently dictionary-sourced either.
- **~35 concepts have nothing at all** — no dictionary word, no existing proposal.

The non-affiliation paragraph (§6) has the worst coverage of the seven and the highest
stakes if gotten wrong — it is the one place in this entire worksheet where "wait for a
native reviewer" is not caution for its own sake.

# Urhobo UI — Proposed Community Localization v0.1

**Status: Urhobo — Proposed Community Localization v0.1. This is explicitly NOT
"Urhobo — Native-verified translation."** Everything below (except one key) is
an AI-assisted working construction, supplied by the product owner for this
exact purpose, wired into `src/pages/election/uiStrings.js`'s `urh` object
unchanged — never "improved," re-worded, or second-guessed by any later model
or tool pass. It carries the selector's existing "(Review)" honesty badge
(`languageCapability.js`, unchanged), the same badge Hausa/Igbo/Pidgin/Yoruba's
own AI-drafted UI strings already carry. No native Urhobo speaker has reviewed
any of this yet. Community and native-speaker review is expected post-launch,
and is the actual point of shipping it labeled this way rather than waiting.

This does **not** reopen, weaken, or set a precedent against this project's
standing rule against inventing Urhobo elsewhere — `src/os/studio/urhobo/
lexicon.js`, `technical.js`, and `phrases.js` (the sourced dictionary research
behind the 27 Ask ElectionCanon response templates) are unchanged, and the 27
templates themselves remain 0/27 approved. This is a one-time, scoped, clearly
labeled exception for ordinary landing-page and Home/Overview UI chrome only.

---

## 0. A correction made on intake — read this before trusting any "verified" label below

The source material this pass was drafted from (two documents: an initial
"Urhobo working vocabulary" research pass, and a follow-up structured JSON
implementation list) labeled a number of entries `EXISTING_PROJECT_RESEARCH` or
`SOURCE_VERIFIED`, citing `src/os/studio/urhobo/technical.js` and `lexicon.js`
by file path as the source for terms including Election, Election Day, Polling
Unit, Campaign, Operating System, Readiness, Responsibility, Event, Record, and
Start.

**Those citations were checked against the actual content of both files and do
not hold up.** `technical.js`'s `TECHNICAL` array contains exactly these 25
English keys: `organisation, workshop, manufacturing, engineering, inspection,
production, component, specification, mission, project, responsible,
contribution, participant, coordination, instruction, acknowledgement,
approval, evidence, measurement, state, event, recommendation, authority,
Canon, knowledge`. It does not contain "election," "election day," "polling
unit," "campaign," "operating system," or "readiness" as an entry at all. Where
an entry name does coincide (`event`, `responsible`, `coordination`), that
file's own `candidate` field is `null` — explicitly no Urhobo word recorded.
`lexicon.js`'s `BASIC`/`CONTENT`/`INTERROGATIVES` lists have no "start" entry
either, so `Tonnọ` for "Start" is not sourced from there.

**Every status below has therefore been corrected to `UNVERIFIED`**, except the
one key that genuinely does trace to this project's own cited Urhobo
dictionary research: `studio.languageHeading` → `Éphérẹ`, from Ukere's
*Urhobo–English Dictionary* (`éphérẹ1 n. language`), already live before this
pass and unchanged by it.

This correction is about **provenance**, not necessarily about whether the
drafted wording itself is good or bad Urhobo — it may well be reasonable. The
point is narrower and non-negotiable: an honest product cannot repeat a
specific, checkable "this came from our own prior research" claim once that
claim has been shown false. See `src/pages/election/uiStrings.js`'s own header
comment above the `urh` object for the same note in code.

---

## 1. Status tiers actually used in this codebase

`uiStrings.js` exports `URHOBO_PROPOSAL_STATUS`, a frozen `{key: status}` map
(documentation/audit layer only — `t()` never reads it). Three tiers, not the
source material's original five, because this project could not independently
stand behind a finer-grained scheme than it could actually check:

| Tier | Meaning | Count |
|---|---|---|
| `SOURCE_VERIFIED` | A cited dictionary source gives this word for this sense. | 1 |
| `UNVERIFIED` | An AI-assisted working construction with no dictionary citation this project can check. Not a claim the wording is *wrong* — only that it is unconfirmed. | 70 |
| `UNVERIFIED_INTERNALLY_DISPUTED` | `UNVERIFIED`, **and** the source material's own first-pass draft explicitly recommended keeping this exact concept in English "until Urhobo contributors have reviewed the concepts," before a later pass overrode that under the disproven citation above. Priority community-review candidates. | 7 |

**Total Urhobo keys with any value at all: 78** (1 `SOURCE_VERIFIED` + 77 v0.1
proposals). Everything else among the ~103 Landing/Home keys inventoried in
`UI-STRING-INVENTORY.md` §5 stays an honest, sentinel-tracked English fallback
(`INTENTIONAL_FALLBACKS.urh === "ALL_UNDRAFTED"` — unchanged mechanism).

### The 7 `UNVERIFIED_INTERNALLY_DISPUTED` keys

| Key | English | Proposed | Why disputed |
|---|---|---|---|
| `landing.chainEvent` | Event | Ẹfiamu | Source material's own first pass: "I would not force translations for... Event... until Urhobo contributors have reviewed the concepts." |
| `landing.chainRecord` | Record | Ekere | Same note, "Record." |
| `landing.step.responsibility` | Responsibility | Iruo-ẹso | Same note, "Responsibility." |
| `nav.readiness` | Readiness | Ẹmwana | Same note, "Readiness." |
| `landing.step.electionDay` | Election Day | Ẹdẹ Ẹserovwo | Same note, "Election Day." |
| `landing.categoryOperational` | Operational | Oru-iruo | Same note, "Operational." |
| `landing.categoryInDevelopment` | In Development | O ro osẹ | Same note, "In Development." |

### Two proposed values deliberately NOT shipped, honored as the source material itself recommended

- **`home.toneUrgent`** ("Urgent") — proposed `Kpákpákpá`. The source
  material's own author: *"I would not ship this particular term without
  Urhobo review... it needs confirmation of whether the intended sense is
  'urgent' rather than merely 'fast/immediate.'"* Stays English.
- **`home.operationalStatus`** ("Operational status") — the source material's
  own author: *"I would not invent this one... keeping the technical English
  term is safer during the community phase."* Stays English.

### `NO_DEFENSIBLE_PROPOSAL` — correctly absent, stays English

`landing.heroBody`, `landing.problemBody`, `landing.canonBody`,
`landing.openSourceBody1`, `landing.openSourceBody2`, `landing.nonAffiliation`,
`landing.startBody` — long architectural/legal/disclaimer prose the source
material itself flagged as too risky to approximate. No Urhobo value exists
for these; they fall back to English via the same sentinel as everything else
undrafted.

### Also not duplicated

`nav.canon` was proposed as `"Canon"` — identical to the English value already
used by every other language (Canon is a proper noun, never translated) — so
it was not added to `urh`; the existing fallback already produces the correct,
identical result.

---

## 2. Safety-critical strings — untouched

None of the 5 `SAFETY_GATED_KEYS` (`electionDay.simDisclosure`,
`electionDay.simPhotoDisclosure`, `electionDay.simResultsDisclosure`,
`studio.noAiImageDisclosure`, `ask.languageFallbackBanner`) were in scope for
this pass, were proposed a value by the source material, or appear in `urh` or
`URHOBO_PROPOSAL_STATUS`. They remain English-only for every non-English
language, Urhobo included, until a human sets `approved: true` — unchanged.

---

## 3. What this is for

This document, together with `URHOBO_PROPOSAL_STATUS` in code, is the
reviewable surface for Urhobo community contributors and any future native
reviewer: it names exactly which 78 strings carry a value, which single one is
dictionary-backed, which 7 are flagged for priority re-examination, and which
~25 remain deliberately in English. Nothing here claims more certainty than it
has.

# ElectionCanon — UI String Inventory (Phase 1 of the Six-Language UI Pass)

> **§0 and §4 below are superseded.** Phase 2 (the `t()` accessor, `uiStrings.js`, and wiring
> across `src/pages/election/*.jsx`) was completed in a later pass than this document describes,
> and is itself further extended by the **Visibility Expansion Pass** (§5 below) — the public
> landing page (`src/pages/Landing.jsx`, explicitly called out as out-of-scope in §0 at the time
> this document was written) and the remaining highest-visibility Home strings are now wired and
> translated too. §1–3's inventory of the authenticated-shell keys remains accurate background;
> read §5 for the current, authoritative state of what exists.

**This is Phase 0 + Phase 1 only: inspection and cataloguing.** No translation-key accessor has
been built, no component has been wired to consume one, and no string below has been translated.
That is Phase 2+, explicitly **not attempted in this pass** — see §0 for why, and what it will
actually take.

**Scope of this inventory:** the authenticated ElectionCanon product shell — `src/pages/Election.jsx`
plus every file in `src/pages/election/` (19 files, ~8,100 lines) — the surface the
`LanguageSelector` actually lives on. `Landing.jsx` and `Access.jsx` (the public marketing/
registration pages, reached *before* a language is ever selected) and the `e0X-preview`/`AD01`
launch-media files (not part of the product, already confirmed unrouted/orphaned or launch-funnel-
only in prior audits this session) are **out of scope** for this specific inventory — flagged here,
not silently omitted.

**Coverage claim, stated honestly:** every one of the 19 in-scope files was searched for visible-
text patterns (JSX text nodes, `label=`/`title=`/`placeholder=`/`aria-label=`/`alt=` attributes,
and object-literal `label:`/`title:` fields feeding reusable components like `<Label>`/`<DemoTag>`/
`<Empty>`/`<StatusRow>`/`<NotStartedRow>`/`<CountRow>`). This is a **strong first-pass inventory**,
not a claim of byte-perfect, every-single-node exhaustiveness — at this file count and line count,
a small number of deeply-nested or unusually-constructed strings may have been missed. Where that
matters, re-running the same search patterns against a specific file is cheap; this document should
not be treated as frozen if a future pass finds a gap.

---

## 0. Why Phase 2 (actual translation + wiring) is not in this document

This project's own prior research already assessed this exact category of work. From
`docs/multilingual/UI-TERMS.md` §4: *"a full-codebase string extraction, a UI-string translation
accessor mirroring `respond.js`'s pattern, and per-string review — not a quick addition to the
current 27-template gate"* — i.e., **materially larger and separate** from the Ask ElectionCanon
conversational-template work (the 27×6 = 162 templates already drafted across the six language
packs). This inventory is step one of that larger, separate task. Building the `t()`-style
accessor, wiring every one of the ~19 files to it, and drafting (then native-reviewing) every
string below across five non-English languages is real, multi-session engineering work — attempting
it in the same pass as this inventory would mean rushing exactly the kind of fabricated-confidence
translation this project has consistently refused elsewhere. It is scoped here, not attempted here.

---

## 1. Two separate "language" concepts already exist in this codebase — both relevant, neither to be merged

1. **Session-wide interaction language** (`src/pages/election/LanguageContext.jsx`,
   `useLanguageSession()`) — the one this entire six-language effort has built on: `en/ha/ig/pcm/
   urh/yo`, drives Ask ElectionCanon's realiser. This inventory's translation keys are meant to
   plug into **this** system once a UI-string accessor is built alongside it.
2. **Creative Studio's own three-axis language model** (`src/pages/election/MotionPreview.jsx` —
   "Interface" / "Talk to AI in" / "Graphic text in", backed by `UserLanguageContext` per the A.7
   Creative Studio work) — a **different, independently-settable** axis set specific to the
   creative/motion editor, predating this six-language pass. Its three dropdown labels are
   inventoried below under Studio, but the dropdown *options themselves* (the language list each
   one offers) are a separate, already-existing concern this pass does not touch or duplicate.

Do not collapse these into one system — they answer different questions ("what language do I see
the UI in" vs. "what language should a generated graphic's text be in").

---

## 2. Inventory

Translation keys follow `<area>.<specific>` — reusing a key across files wherever the exact same
string already repeats verbatim (e.g. every "Cancel" button, every "No … yet" empty state of the
same shape) rather than inventing a new key per occurrence, matching this codebase's own "reuse the
existing registry, never declare a second one" convention.

### 2.1 Primary navigation (`shared.jsx` — `SECTIONS`, the authoritative source for all 11 tabs)

| ID | Source file | Component | English string | Category | Translation key |
|---|---|---|---|---|---|
| N01 | shared.jsx:98 | SECTIONS | Overview | nav | `nav.home` |
| N02 | shared.jsx:99 | SECTIONS | People | nav | `nav.organisation` |
| N03 | shared.jsx:100 | SECTIONS | Places | nav | `nav.territory` |
| N04 | shared.jsx:101 | SECTIONS | Work | nav | `nav.mobilize` |
| N05 | shared.jsx:102 | SECTIONS | Election Operations | nav | `nav.electionDay` |
| N06 | shared.jsx:103 | SECTIONS | Coordination | nav | `nav.chat` |
| N07 | shared.jsx:104 | SECTIONS | Studio | nav | `nav.studio` |
| N08 | shared.jsx:105 | SECTIONS | Ask ElectionCanon | nav | `nav.intelligence` |
| N09 | shared.jsx:106 | SECTIONS | Canon | nav | `nav.canon` |
| N10 | shared.jsx:107 | SECTIONS | Readiness | nav | `nav.readiness` |
| N11 | shared.jsx:108 | SECTIONS | System | nav | `nav.settings` |
| N12 | primitives.jsx:112 | PrimaryNav | Primary (aria-label) | a11y | `a11y.primaryNav` |
| N13 | primitives.jsx:129,145 | PrimaryNav | Open/Close navigation menu | a11y | `a11y.navMenuOpen` / `a11y.navMenuClose` |
| N14 | primitives.jsx:138 | PrimaryNav | Primary navigation (dialog aria-label) | a11y | `a11y.navDialog` |
| N15 | primitives.jsx:144 | PrimaryNav | Navigate | nav | `nav.drawerHeading` |

### 2.2 Shared/cross-cutting chrome (`shared.jsx`, used on every page)

| ID | Source file | English string | Category | Translation key |
|---|---|---|---|---|
| S01 | shared.jsx:271 | ElectionCanon (brand kicker) | brand | not translated — proper noun |
| S02 | shared.jsx:283 | Sign out | action | `action.signOut` |
| S03 | shared.jsx:375,451 | Proposed action — not yet recorded | status | `status.proposedNotRecorded` |
| S04 | shared.jsx:390,434,470 | Cancel | action | `action.cancel` |
| S05 | shared.jsx:432 | Record a campaign action | heading | `ask.recordActionHeading` |
| S06 | shared.jsx:436 | Action (placeholder: e.g. "Assign Team 6 to Ward 6"...) | placeholder | `ask.recordActionPlaceholder` |

### 2.3 Overview (`HomeSection.jsx`, `HomeResponsibility.jsx`)

| ID | Source file | English string | Category | Translation key |
|---|---|---|---|---|
| H01 | HomeSection.jsx:129 | Your scope | heading | `home.yourScope` |
| H02 | HomeSection.jsx:359,503 | Your election | heading | `home.yourElection` |
| H03 | HomeSection.jsx:367 | No active responsibility | empty-state | `home.noActiveResponsibility` |
| H04 | HomeSection.jsx:519 | What to do next | heading | `home.whatToDoNext` |
| H05 | HomeSection.jsx:562 | What needs attention today | heading | `home.whatNeedsAttention` |
| H06 | HomeSection.jsx:613 | What changed | heading | `home.whatChanged` |
| H07 | HomeSection.jsx:616 | No organisational activity recorded yet. | empty-state | `home.noActivityYet` |
| H08 | HomeSection.jsx:650 | Your wards | heading | `home.yourWards` (reused: territory/mobilize) |
| H09 | HomeSection.jsx:668 | Your polling units | heading | `home.yourPollingUnits` |
| H10 | HomeSection.jsx:703 | Coverage — LGAs and wards | heading | `home.coverageLgasWards` |
| H11 | HomeSection.jsx:714 | Operational status (aria-label + heading) | heading/a11y | `home.operationalStatus` |
| H12 | HomeSection.jsx:717 | Readiness / Open Readiness | status-row | `nav.readiness` (reused) / `action.openReadiness` |
| H13 | HomeSection.jsx:719 | Mobilization / Open Mobilize | status-row | `nav.mobilize` (reused) / `action.openMobilize` |
| H14 | HomeSection.jsx:721 | Communications / Open Chat | status-row | `chat.communications` / `action.openChat` |
| H15 | HomeSection.jsx:723 | Campaign Studio / Open Studio | status-row | `nav.studio` (reused) / `action.openStudio` |
| H16 | HomeSection.jsx:725 | Election Day / Open Election Day | status-row | `nav.electionDay` (reused) / `action.openElectionDay` |
| H17 | HomeResponsibility.jsx:39,56 | Coverage | heading | `coverage.heading` (reused across Places/Work) |
| H18 | HomeResponsibility.jsx:86 | No LGAs or wards known for this campaign's territory yet. | empty-state | `territory.noLgasWardsYet` |
| H19 | HomeResponsibility.jsx:191 | New responsible person | form-label | `responsibility.newPerson` |
| H20 | HomeResponsibility.jsx:199,201 | Reason (label + placeholder "e.g. Relocated, stepped back…") | form-label | `responsibility.reason` / `responsibility.reasonPlaceholder` |
| H21 | HomeResponsibility.jsx:216 | Confirm | heading | `action.confirmHeading` |
| H22 | HomeResponsibility.jsx:229 | Back | action | `action.back` |
| H23 | HomeResponsibility.jsx:298 | No polling units imported yet for this ward. | empty-state | `territory.noPuImportedWard` (reused) |

### 2.4 People (`OrganisationSection.jsx`)

| ID | Source file | English string | Category | Translation key |
|---|---|---|---|---|
| P01 | OrganisationSection.jsx:323 | Invitation created | status | `org.invitationCreated` |
| P02 | OrganisationSection.jsx:339 | Done | action | `action.done` |
| P03 | OrganisationSection.jsx:353/354 | Name (label + placeholder "e.g. John Doe") | form | `org.name` / `org.namePlaceholder` |
| P04 | OrganisationSection.jsx:355/356 | Email (label + placeholder "e.g. john@example.com") | form | `org.email` / `org.emailPlaceholder` |
| P05 | OrganisationSection.jsx:367 | Campaign Director | role-label | `role.director` |
| P06 | OrganisationSection.jsx:368 | LGA Coordinator | role-label | `role.lgaCoordinator` (reused widely) |
| P07 | OrganisationSection.jsx:369 | Ward Coordinator | role-label | `role.wardCoordinator` (reused widely) |
| P08 | OrganisationSection.jsx:370 | Polling-Unit Agent | role-label | `role.puAgent` (reused widely) |
| P09 | OrganisationSection.jsx:395,397 | Ward / Select an LGA first. | form/empty | `territory.ward` / `territory.selectLgaFirst` |
| P10 | OrganisationSection.jsx:416 | Select a ward first. | empty | `territory.selectWardFirst` |
| P11 | OrganisationSection.jsx:440 | Review | heading | `action.reviewHeading` |
| P12 | OrganisationSection.jsx:444 | Territory: (inline label before the LGA→Ward→PU breadcrumb) | inline-label | `org.territoryPrefix` |
| P13 | OrganisationSection.jsx:522 | Language capabilities | heading | `org.languageCapabilities` |
| P14 | OrganisationSection.jsx:528 | No members to show. | empty | `org.noMembers` |
| P15 | OrganisationSection.jsx:550 | No declared language capability yet. | empty | `org.noLanguageCapability` |
| P16 | OrganisationSection.jsx:696 | Who's involved | heading | `org.whosInvolved` |
| P17 | OrganisationSection.jsx:703 | No team members yet. | empty | `org.noTeamYet` |
| P18 | OrganisationSection.jsx:720 | ACTIVE (status chip) | status | `status.active` |
| P19 | OrganisationSection.jsx:731 | Invitations | heading | `org.invitationsHeading` |
| P20 | OrganisationSection.jsx:750 | Revoke | action | `action.revoke` |
| P21 | OrganisationSection.jsx:762 | Set your territory in the Territory tab before inviting people. | guidance | `org.needTerritoryFirst` |

### 2.5 Places (`TerritorySection.jsx`, `TerritoryExplorer.jsx`)

| ID | Source file | English string | Category | Translation key |
|---|---|---|---|---|
| T01 | TerritorySection.jsx:113 | Your assigned territory | heading | `territory.yourAssigned` |
| T02 | TerritorySection.jsx:127,157,179 | No wards/polling units imported yet for this LGA/ward. | empty | `territory.noWardsImported` / `territory.noPuImportedWard` (reused) |
| T03 | TerritorySection.jsx:251 | Set your electoral territory | heading | `territory.setYours` |
| T04 | TerritorySection.jsx:263 | Election (placeholder "e.g. 2027 General Election") | form | `territory.electionPlaceholder` |
| T05 | TerritorySection.jsx:265,270,276 | Office / State / Constituency (form labels) | form | `territory.office` / `territory.state` / `territory.constituency` |
| T06 | TerritoryExplorer.jsx:182,186,190 | LGA coordinators / Ward coordinators / Polling-unit agents | sub-heading | `role.lgaCoordinator` / `role.wardCoordinator` / `role.puAgent` (all reused) |
| T07 | TerritoryExplorer.jsx:203 | Assign Constituency Lead | heading/title | `role.constituencyLead` + `action.assign` |
| T08 | TerritoryExplorer.jsx:210 | Local Government Areas | heading | `territory.lgas` |

### 2.6 Work (`MobilizeSection.jsx`)

| ID | Source file | English string | Category | Translation key |
|---|---|---|---|---|
| M01 | MobilizeSection.jsx:99 | Field roster | heading | `mobilize.fieldRoster` |
| M02 | MobilizeSection.jsx:102 | No people added yet. | empty | `mobilize.noPeopleYet` |
| M03 | MobilizeSection.jsx:116 | Add person | action/title | `action.addPerson` |
| M04 | MobilizeSection.jsx:144 | Your wards | heading | `home.yourWards` (reused) |
| M05 | MobilizeSection.jsx:178 | Assignments | heading | `mobilize.assignments` |
| M06 | MobilizeSection.jsx:181 | No assignments recorded yet. | empty | `mobilize.noAssignmentsYet` |
| M07 | MobilizeSection.jsx:194 | Change assignment status | action/title | `action.changeAssignmentStatus` |
| M08 | MobilizeSection.jsx:209 | Create assignment | action/title | `action.createAssignment` |
| M09 | MobilizeSection.jsx:227 | Tasks | heading | `mobilize.tasks` |
| M10 | MobilizeSection.jsx:230 | No tasks created yet. | empty | `mobilize.noTasksYet` |
| M11 | MobilizeSection.jsx:246 | Change task status | action/title | `action.changeTaskStatus` |
| M12 | MobilizeSection.jsx:259 | Create task | action/title | `action.createTask` |
| M13 | MobilizeSection.jsx:300 | Agent coverage by geography | heading | `mobilize.agentCoverage` |
| M14 | MobilizeSection.jsx:306 | National | scope-label | `territory.national` |

### 2.7 Election Operations (`ElectionDaySection.jsx`)

| ID | Source file | English string | Category | Translation key |
|---|---|---|---|---|
| E01 | ElectionDaySection.jsx:87 | Coverage — state / LGA / ward / polling unit | heading | `electionDay.coverageHeading` |
| E02 | ElectionDaySection.jsx:90,880 | Simulation / demonstration data — not official election results | **disclosure** | `electionDay.simDisclosure` (safety-critical — see §3) |
| E03 | ElectionDaySection.jsx:92 | No polling units added yet. | empty | `electionDay.noPuYet` |
| E04 | ElectionDaySection.jsx:121 | Add polling unit | action/title | `action.addPollingUnit` |
| E05 | ElectionDaySection.jsx:146 | Polling-unit agents | heading | `electionDay.puAgentsHeading` |
| E06 | ElectionDaySection.jsx:148 | No agents assigned yet. | empty | `electionDay.noAgentsYet` |
| E07 | ElectionDaySection.jsx:163 | Change agent status | action/title | `action.changeAgentStatus` |
| E08 | ElectionDaySection.jsx:176 | Assign agent | action/title | `action.assignAgent` |
| E09 | ElectionDaySection.jsx:200 | Result-sheet evidence photo (alt text) | a11y | `electionDay.evidencePhotoAlt` |
| E10 | ElectionDaySection.jsx:310 | Simulation content — real photo upload, not an official result | **disclosure** | `electionDay.simPhotoDisclosure` |
| E11 | ElectionDaySection.jsx:319,321 | Polling unit (select) / "No polling units yet — add one first" | form/empty | `electionDay.puSelect` / `electionDay.noPuAddOneFirst` |
| E12 | ElectionDaySection.jsx:344 | Extracted fields (manual entry) | heading | `electionDay.extractedFields` |
| E13 | ElectionDaySection.jsx:600 | Verification decision (aria-label) | form | `electionDay.verificationDecision` |
| E14 | ElectionDaySection.jsx:639,641 | Results (simulation) / Simulated election data — not official results | **heading + disclosure** | `electionDay.resultsHeading` / `electionDay.simResultsDisclosure` |
| E15 | ElectionDaySection.jsx:643 | No results captured yet. | empty | `electionDay.noResultsYet` |
| E16 | ElectionDaySection.jsx:686 | Verify result | action/title | `action.verifyResult` |
| E17 | ElectionDaySection.jsx:698 | Capture result | heading | `electionDay.captureResult` |
| E18 | ElectionDaySection.jsx:725 | Incident log | heading | `electionDay.incidentLog` |
| E19 | ElectionDaySection.jsx:727 | No incidents reported. | empty | `electionDay.noIncidentsYet` |
| E20 | ElectionDaySection.jsx:754 | Update incident status | action/title | `action.updateIncidentStatus` |
| E21 | ElectionDaySection.jsx:771 | Report incident | action/title | `action.reportIncident` |
| E22 | ElectionDaySection.jsx:875 | Election Operations | heading | `nav.electionDay` (reused) |

### 2.8 Coordination (`ChatSection.jsx`)

| ID | Source file | English string | Category | Translation key |
|---|---|---|---|---|
| C01 | ChatSection.jsx:45 | Coordination rooms | heading | `chat.coordinationRooms` |
| C02 | ChatSection.jsx:69 | Room type | form-label | `chat.roomType` |
| C03 | ChatSection.jsx:80,81 | New room name (placeholder "e.g. Ward 3 Coordination") | form | `chat.newRoomName` / `chat.newRoomPlaceholder` |
| C04 | ChatSection.jsx:85 | Create | action | `action.create` (reused: Communications too) |
| C05 | ChatSection.jsx:88 | Cancel | action | `action.cancel` (reused) |
| C06 | ChatSection.jsx:117 | No messages yet — say hello. | empty | `chat.noMessagesYet` |
| C07 | ChatSection.jsx:151 | Reference type (aria-label) | form | `chat.referenceType` |
| C08 | ChatSection.jsx:155,156 | its id (placeholder) / Reference id | form | `chat.referenceIdPlaceholder` / `chat.referenceId` |
| C09 | ChatSection.jsx:162 | Write a message… / Message | form | `chat.messagePlaceholder` / `chat.message` |
| C10 | ChatSection.jsx:166 | Send | action | `action.send` |
| C11 | ChatSection.jsx:258 | Rooms | heading | `chat.roomsHeading` |
| C12 | ChatSection.jsx:262 | Conversation | heading | `chat.conversationHeading` |

### 2.9 Studio (`CampaignStudioSection.jsx`, `MotionPreview.jsx`)

| ID | Source file | English string | Category | Translation key |
|---|---|---|---|---|
| ST01 | CampaignStudioSection.jsx:118 | Text/colour only — no AI image generation connected | **disclosure** | `studio.noAiImageDisclosure` |
| ST02 | CampaignStudioSection.jsx:121 | Asset title | form | `studio.assetTitle` |
| ST03 | CampaignStudioSection.jsx:211 | Templates | heading | `studio.templatesHeading` |
| ST04 | CampaignStudioSection.jsx:218,221 | Your assets / "No assets yet — choose a template to start one." | heading/empty | `studio.yourAssets` / `studio.noAssetsYet` |
| ST05 | CampaignStudioSection.jsx:227,233 | Editor / "Choose a template or open a saved asset to start editing." | heading/empty | `studio.editorHeading` / `studio.chooseTemplate` |
| ST06 | MotionPreview.jsx:653 | Family (creative family selector) | form | `studio.family` |
| ST07 | MotionPreview.jsx:662 | Language (section heading — Creative Studio's OWN 3-axis block, see §1) | heading | `studio.languageHeading` |
| ST08 | MotionPreview.jsx:665,667 | Interface (label) / Interface language (aria-label) | form | `studio.interfaceLanguage` |
| ST09 | MotionPreview.jsx:672,674 | Talk to AI in / AI interaction language | form | `studio.aiInteractionLanguage` |
| ST10 | MotionPreview.jsx:679,681 | Graphic text in / Creative output language | form | `studio.creativeOutputLanguage` |
| ST11 | MotionPreview.jsx:753 | Opacity | form | `studio.opacity` |
| ST12 | MotionPreview.jsx:759 | No photo added | empty | `studio.noPhotoAdded` |
| ST13 | MotionPreview.jsx:768,771 | Tell the studio what to change (placeholder: "center the headline") | form | `studio.creativeCommandPlaceholder` |

### 2.10 Ask ElectionCanon (`IntelligenceSection.jsx`, `AskAssistant.jsx`)

| ID | Source file | English string | Category | Translation key |
|---|---|---|---|---|
| A01 | IntelligenceSection.jsx:115,AskAssistant.jsx:173 | Ask ElectionCanon (heading / input placeholder / aria-label) | heading/form | `nav.intelligence` (reused) |
| A02 | IntelligenceSection.jsx:120 | Alerts / "No open alerts." | heading/empty | `ask.alerts` / `ask.noOpenAlerts` |
| A03 | IntelligenceSection.jsx:129 | Coverage gaps | heading | `ask.coverageGaps` |
| A04 | IntelligenceSection.jsx:143 | Ward coverage | heading | `ask.wardCoverage` |
| A05 | IntelligenceSection.jsx:152 | Task bottlenecks | heading | `ask.taskBottlenecks` |
| A06 | IntelligenceSection.jsx:162 | Election-day simulation statistics | heading | `ask.electionDaySimStats` |
| A07 | IntelligenceSection.jsx:173 | Activity trend | heading | `ask.activityTrend` |
| A08 | AskAssistant.jsx:229 | Close Ask ElectionCanon (aria-label) | a11y | `a11y.closeAsk` |
| A09 | (not newly listed — already fully inventoried in `test/election-multilingual.consumer.mjs` §D) | fallback banner copy, "Voice · soon" button | status/disclosure | `ask.languageFallbackBanner` / `voice.comingSoon` |

### 2.11 Canon (`EventsSection.jsx`)

| ID | Source file | English string | Category | Translation key |
|---|---|---|---|---|
| CN01 | EventsSection.jsx:210,274 | Canon | heading | `nav.canon` (reused) |
| CN02 | EventsSection.jsx:291 | Filter by category (aria-label/role=group) | a11y | `canon.filterByCategory` |
| CN03 | EventsSection.jsx:342 | When: | inline-label | `canon.whenLabel` |
| CN04 | EventsSection.jsx:346 | Where: | inline-label | `canon.whereLabel` |
| CN05 | EventsSection.jsx:351 | Status: | inline-label | `canon.statusLabel` |
| CN06 | EventsSection.jsx:355 | Record: | inline-label | `canon.recordLabel` |

### 2.12 Readiness (`Election.jsx`'s readiness-dimension block)

| ID | Source file | English string | Category | Translation key |
|---|---|---|---|---|
| R01 | Election.jsx:456 | Readiness claims (CANON) | heading | `readiness.claimsHeading` |
| R02 | Election.jsx:463 | Known ward coverage | heading | `readiness.knownWardCoverage` |
| R03 | Election.jsx:488 | Gaps (CANON-derived) | heading | `readiness.gapsHeading` |
| R04 | Election.jsx:504,517,526,536,539,568,575,583 | "Not yet tracked by ElectionCanon." / "No … recorded yet." (per-dimension notes) | empty/status | `readiness.notTrackedYet` (shared template, interpolated with the dimension name) |
| R05 | Election.jsx:527,540,547,554,561,576,584 | "{n} person(s)/ward(s)/…in the roster/known/configured/assigned/recorded/captured/logged." (count templates) | status (interpolated) | `readiness.countTemplate.*` — one key per dimension (people/wards/pollingUnits/agents/assignmentsTasks/results/incidents) |

### 2.13 System / Welcome / Access-adjacent (`Election.jsx`)

| ID | Source file | English string | Category | Translation key |
|---|---|---|---|---|
| SY01 | Election.jsx:144 | Welcome | heading | `welcome.heading` |
| SY02 | Election.jsx:186 | Available now | heading | `welcome.availableNow` |
| SY03 | Election.jsx:193 | Coming next | heading | `welcome.comingNext` |
| SY04 | Election.jsx:207 | Set up your election workspace | heading | `welcome.setUpWorkspace` |
| SY05 | Election.jsx:396 | Complete candidate registration | heading | `candidate.completeRegistration` |
| SY06 | Election.jsx:400 | Already set on Territory — not asked again here. | guidance | `candidate.alreadySetOnTerritory` |
| SY07 | Election.jsx:404,405 | Candidate's full name (placeholder) | form | `candidate.namePlaceholder` |
| SY08 | Election.jsx:406,407 | Party | form | `candidate.party` |

### 2.14 Repeated/cross-cutting primitives (appear across most files above — single shared key each)

| English string | Where seen | Translation key |
|---|---|---|
| Cancel | shared, OrganisationSection, HomeResponsibility, TerritorySection, ElectionDaySection (×3), ChatSection | `action.cancel` |
| Create | ChatSection, Communications | `action.create` |
| Done | OrganisationSection | `action.done` |
| Reason | HomeResponsibility, OrganisationSection (revocation) | `common.reason` |
| "No … yet" / "No … recorded" empty states | every section | `common.emptyStatePattern` (family of keys, one per entity) |
| `<Label>` component itself | shared.jsx (used everywhere above) | n/a — a styling wrapper, not itself translatable copy |
| `<DemoTag>` / simulation disclosures | CampaignStudioSection, ElectionDaySection (×4) | `status.simulated` family — **see §3, safety-critical** |

### 2.15 Communications (`Communications.jsx`)

| ID | Source file | English string | Category | Translation key |
|---|---|---|---|---|
| CM01 | Communications.jsx:140,141 | Reason for revoking… / Revocation reason | form | `common.reason` (reused) / `comms.revocationReason` |
| CM02 | Communications.jsx:164,166 | Your review / Notes (required if rejecting) | heading/form | `comms.yourReview` / `comms.reviewNotes` |
| CM03 | Communications.jsx:320,322,323 | Brief / Internal context for the communication… | form/guidance | `comms.brief` / `comms.briefGuidance` |
| CM04 | Communications.jsx:327,329 | Master text | form | `comms.masterText` |
| CM05 | Communications.jsx:334 | Save brief / master text | action | `action.saveBriefMasterText` |
| CM06 | Communications.jsx:342 | No assets attached yet. | empty | `comms.noAssetsAttached` |
| CM07 | Communications.jsx:349,353 | Attach a Studio asset / Attach | form/action | `comms.attachAsset` / `action.attach` |
| CM08 | Communications.jsx:371,377,378 | Add a language variant / Variant text / Add variant | form/action | `comms.addLanguageVariant` / `comms.variantText` / `action.addVariant` |
| CM09 | Communications.jsx:435 | Communications | heading | `chat.communications` (reused) |
| CM10 | Communications.jsx:438,439 | New communication title | form | `comms.newTitlePlaceholder` |
| CM11 | Communications.jsx:443 | No communications yet — create one to start planning. | empty | `comms.noCommsYet` |
| CM12 | Communications.jsx:449,456 | Detail / "Choose a communication to see its linked assets and language variants." | heading/empty | `comms.detailHeading` / `comms.chooseCommGuidance` |

---

## 3. Safety-critical strings — flagged separately, not just another row

These are the strings this project's own architecture treats as **non-negotiable disclosures**,
not ordinary copy. Any future translation pass (Phase 2+) must verify these preserve their exact
operational meaning in every language, with the same rigor the 27 Ask ElectionCanon templates
already got — these are not lower-stakes just because they're "UI text":

- `electionDay.simDisclosure` / `electionDay.simPhotoDisclosure` / `electionDay.simResultsDisclosure`
  (E02, E10, E14) — must never translate in a way that could read as "real" or "official" results.
- `studio.noAiImageDisclosure` (ST01) — must never translate in a way that implies AI image
  generation is connected when it isn't.
- `ask.languageFallbackBanner` (A09) — the exact banner this whole six-language effort depends on
  to honestly disclose a fallback-to-English answer; translating *this specific string* into each
  of the five non-English languages is arguably **higher priority** than translating the rest of
  the UI, since a user who can't read English needs to understand in their OWN language that
  they're currently reading an English answer.

---

## 4. What Phase 2 actually requires (not attempted here)

1. A `t(key, lang)`-style accessor, modeled on `respond.js`'s own `fill()`/`approvedTemplate()`
   pattern — reading from six per-language UI-string packs (`src/os/studio/<lang>/ui.js` or
   similar), gated the identical `approved`/`allXApproved()` way the response templates are, so a
   half-translated UI can never silently go live.
2. Wiring every one of the ~150 keys above into its actual JSX call site across 19 files —
   itself a large, mechanical-but-careful refactor (every `<Label>Overview</Label>` becomes
   `<Label>{t('nav.home')}</Label>`, etc.), with its own regression-test pass per file.
2a. Deciding whether Creative Studio's existing three-axis `UserLanguageContext` (§1) should
    read from the session language by default, or remain fully independent — a real product
    decision, not an implementation detail.
3. Drafting (AI-assisted, exactly like the 27 response templates) and then native-reviewing
   ~150 keys × 5 languages = ~750 UI strings — a substantially larger drafting effort than the
   162 already done for Ask ElectionCanon, and one this pass does not attempt.
4. New tests: key-coverage (every key has an entry for all six languages, even if `null`),
   placeholder/interpolation integrity for the templated readiness strings (R04/R05), and a
   regression check that the English UI is byte-identical before/after introducing the accessor.

**None of the above is started.** This document is the input Phase 2 would consume.

---

## 5. Visibility Expansion Pass (addendum — current authoritative state)

**Starting point verified by source inspection:** by the time this pass began, Phase 2 had
already shipped — `src/pages/election/uiStrings.js`, `LanguageContext.jsx`, `LanguageSelector.jsx`,
and `useTranslation.js` all existed, and most of `src/pages/election/*.jsx` was already wired
(e.g. `HomeSection.jsx` had 24 `t()` call sites). The one glaring gap, confirmed by grep: **`src/
pages/Landing.jsx` had zero `t()` call sites** — the entire public marketing page was still plain
English JSX, with no `LanguageSelector` and no `LanguageProvider` mounted anywhere on that route.
That gap, plus a handful of still-hardcoded highest-visibility strings in `HomeSection.jsx`
(the "Continue Preparation" button, the attention panel's ALL CLEAR/Urgent/Watch labels, the
per-alert action labels, "View all events — Canon", the no-active-responsibility empty state body,
and the observer/candidate-campaign label), was this pass's entire scope.

**What changed, reusing the existing mechanism unchanged (no second system):**
- `App.jsx` now wraps the `"/"` route in the same `LanguageProvider` `Election.jsx` already
  mounts, scoped to the Landing route only. Both read/write the same `localStorage` key, so a
  language chosen on the landing page is still selected after a visitor signs in.
- `Landing.jsx` now calls `useTranslation()` and renders `<LanguageSelector />` in its hero —
  the identical component the authenticated shell uses, not a duplicate.
- 58 new `landing.*` keys were added to `uiStrings.js`, covering every section's kicker, heading,
  and short labels (hero, problem tags, the Action→Event→Record→Canon chain, the nine-step
  workflow, the campaign-command hierarchy, capability category labels, open-source copy,
  audience chips, the non-affiliation disclaimer, the final CTA, and the footer). Per this
  project's own "reuse the existing registry" convention, labels that already had an established
  translation were reused by key (`territory.office`, `territory.constituency`, `nav.readiness`,
  `nav.chat`, `role.lgaCoordinator`/`wardCoordinator`/`puAgent`, `nav.canon`) rather than
  redeclared. The longer per-step/per-card explanatory body paragraphs were deliberately left
  English for this pass (see the file's own comment at that insertion point) — this is a visible
  landing page, not a fully re-translated one; a future pass can extend coverage further.
- 11 new `home.*`/`action.*` keys close the highest-visibility `HomeSection.jsx` gaps named above.
  The plural-grammar-bearing count sentences (StatusRow detail text, "N of M wards still need…")
  were deliberately left alone, same reasoning as the existing seven `readiness.countTemplate.*`
  deferrals.
- Urhobo was **not** touched — none of the 69 new keys were added to the `urh` object. Every one
  of them automatically falls back to English through `INTENTIONAL_FALLBACKS.urh`'s existing
  `"ALL_UNDRAFTED"` sentinel, so the accounting is honest with zero additional code.
- `test/election-ui-string-coverage.consumer.mjs` now includes `src/pages/Landing.jsx` in its
  scanned file set, so the new `landing.*` keys get the identical six-language coverage proof as
  every other screen. `test/election-multilingual.consumer.mjs` gained a new section K verifying
  the landing page is wired to the same session/selector/dictionary with no second system.

**Translation totals after this pass** (English keys actually consumed by the real UI — see
`election-ui-string-coverage.consumer.mjs` section A): Hausa/Igbo/Nigerian-Pidgin/Yoruba each
define a genuine, non-copy translation for every one of the 69 new keys; the seven pre-existing
`readiness.countTemplate.*` keys remain an intentional, documented fallback for those four
languages. Urhobo remains exactly one genuinely sourced key (`studio.languageHeading`) plus a
fully honest, sentinel-tracked English fallback for everything else — unchanged by this pass, as
instructed.

**What remains untranslated after this pass (explicitly, not silently):** the per-step/per-card
body paragraphs on the landing page (How It Works, Hierarchy, Workspace, Difference sections);
`CAPABILITIES_AVAILABLE_NOW`/`CAPABILITIES_COMING_NEXT` (the shared capability list also read by
the authenticated Welcome screen — translating it is a separate, larger decision affecting two
surfaces at once, out of this pass's bounded scope); and the StatusRow/coverage count sentences
named above. None of these are safety-critical.

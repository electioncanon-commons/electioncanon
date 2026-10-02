// ============================================================
// ELECTIONCANON — UI STRING DICTIONARY  (Six-Language UI Pass, Phase 2)
//
// Same architectural shape as src/os/i18n.js (ForgeOS's own central
// dictionary: flat `{ 'key.path': 'string' }` maps per language, t(key,
// lang) falling back to English) — the "central language state +
// translation resources + UI consumption" pattern this pass was
// explicitly told to reuse. This is a SEPARATE file, not an edit to
// os/i18n.js: that file belongs to a different product surface (Forge
// Manufacturing Commons), a different key set, and (per its own header) a
// 7-language order that includes French — ElectionCanon's own six
// languages, keys, and strings live here instead. Not a second i18n
// *system* — the same one pattern, instantiated for this product's own
// inventory (docs/multilingual/UI-STRING-INVENTORY.md is the authoritative
// key set this file implements).
//
// WHY THIS IS NOT GATED THE SAME WAY AS THE 27 ASK ELECTIONCANON RESPONSE
// TEMPLATES. Those templates are fact-bearing Canon answers — a wrong one
// can misstate what actually happened in a campaign, so EVERY one of them
// is held behind `allTemplatesApproved()` until native review. UI chrome
// (a button label, a section heading, an empty-state sentence) carries
// materially lower operational risk, and this pass's own explicit
// instructions describe missing-value fallback, not an approval gate, as
// the required safety mechanism here. So: ordinary UI keys display their
// AI-drafted value immediately once present — explicitly, visibly
// provisional (see SAFETY_GATED_KEYS below for the one exception), not
// silently claimed as native-reviewed. This mirrors os/i18n.js's own
// stated status exactly: "INITIAL drafts... must be reviewed by native
// speakers before launch" is a real, open item, not a blocker to shipping
// the capability — the same "ship + improve openly" decision already made
// for the conversational templates.
//
// THE ONE EXCEPTION — SAFETY_GATED_KEYS. A short list of strings whose
// mistranslation genuinely could cause harm (a simulation disclosure read
// as "this is real," the Ask ElectionCanon fallback banner silently
// understating that an answer is English, not the requested language).
// These stay in English, ALWAYS, until a human sets `approved: true` on
// that specific key in SAFETY_GATED_APPROVALS below — the exact same
// discipline the 27 response templates already use, applied narrowly to
// the handful of UI strings that deserve it.
//
// INTERPOLATION. `t(key, lang, vars)` replaces `{name}` placeholders the
// same way respond.js's own `fill()` does — never a template-literal
// `eval`, never string concatenation that could be exploited. The
// dynamically-PLURALIZED readiness count strings inventoried in
// UI-STRING-INVENTORY.md §2.12 (R05) have an English template in `en`
// below (the UI must render in English regardless), but a NON-English
// translation of those same seven keys is DELIBERATELY NOT included for
// any of the five other languages — correct pluralization rules differ
// across these six languages (English's simple -s is not Yoruba's,
// Hausa's, Igbo's, or Pidgin's own plural/count grammar), and forcing
// them through a naive {n} substitution would risk exactly the kind of
// fabricated-confidence grammar this project refuses to ship. See
// INTENTIONAL_FALLBACKS below — flagged as explicitly deferred and
// tracked, not silently dropped.
//
// PASS 2 COVERAGE (six-language UI population). Every key the real,
// wired ElectionCanon UI actually calls `t()` with now has a genuine
// Hausa/Igbo/Nigerian-Pidgin/Yoruba translation, EXCEPT the seven
// pluralization-deferred keys above (English fallback, all four) and
// Urhobo, which stays almost entirely an intentional, documented English
// fallback (see the `urh` object and INTENTIONAL_FALLBACKS below) because
// this project's own sourced Urhobo research does not cover this
// vocabulary. None of this is native-reviewed — see the gating note above.
// ============================================================

import { isSupportedLanguageCode, DEFAULT_LANGUAGE } from "./language.js";

// ---------- ENGLISH — the canonical source. Every other language is a
// PARTIAL override of this map; any key it doesn't define falls back here.
const en = Object.freeze({
  // Navigation (SECTIONS in shared.jsx is the authoritative ORDER/id
  // source; these are the authoritative STRING values for those same 11
  // tabs, consumed by the same place rather than a second list).
  "nav.home": "Overview",
  "nav.organisation": "People",
  "nav.territory": "Places",
  "nav.mobilize": "Work",
  "nav.electionDay": "Election Operations",
  "nav.chat": "Coordination",
  "nav.studio": "Studio",
  "nav.intelligence": "Ask ElectionCanon",
  "nav.canon": "Canon",
  "nav.readiness": "Readiness",
  "nav.settings": "System",
  "nav.drawerHeading": "Navigate",

  // Accessibility labels
  "a11y.primaryNav": "Primary",
  "a11y.navMenuOpen": "Open navigation menu",
  "a11y.navMenuClose": "Close navigation menu",
  "a11y.navDialog": "Primary navigation",
  "a11y.closeAsk": "Close Ask ElectionCanon",

  // Shared cross-cutting chrome
  "action.signOut": "Sign out",
  "status.proposedNotRecorded": "Proposed action — not yet recorded",
  "action.cancel": "Cancel",
  "ask.recordActionHeading": "Record a campaign action",
  "ask.recordActionPlaceholder": "e.g. \"Assign Team 6 to Ward 6\" or \"Report Ward 6 as on-track\"",
  "action.prepare": "Prepare",
  "action.preparing": "Preparing…",
  "action.approve": "Approve",
  "action.recording": "Recording…",

  // Overview
  "home.yourScope": "Your scope",
  "home.yourElection": "Your election",
  "home.noActiveResponsibility": "No active responsibility",
  "home.whatToDoNext": "What to do next",
  "home.whatNeedsAttention": "What needs attention today",
  "home.whatChanged": "What changed",
  "home.noActivityYet": "No organisational activity recorded yet.",
  "home.yourWards": "Your wards",
  "home.yourPollingUnits": "Your polling units",
  "home.coverageLgasWards": "Coverage — LGAs and wards",
  "home.operationalStatus": "Operational status",
  "action.openReadiness": "Open Readiness",
  "action.openMobilize": "Open Mobilize",
  "action.openChat": "Open Chat",
  "action.openStudio": "Open Studio",
  "action.openElectionDay": "Open Election Day",
  "home.electionDayLabel": "Election Day",
  "home.mobilizationLabel": "Mobilization",
  "home.studioLabel": "Campaign Studio",
  "coverage.heading": "Coverage",
  "territory.noLgasWardsYet": "No LGAs or wards known for this campaign's territory yet.",
  "responsibility.newPerson": "New responsible person",
  "common.reason": "Reason",
  "responsibility.reasonPlaceholder": "e.g. Relocated, stepped back, better fit for this ward",
  "action.confirmHeading": "Confirm",
  "action.back": "Back",
  "territory.noPuImportedWard": "No polling units imported yet for this ward.",

  // People
  "org.invitationCreated": "Invitation created",
  "action.done": "Done",
  "org.name": "Name",
  "org.namePlaceholder": "e.g. John Doe",
  "org.email": "Email",
  "org.emailPlaceholder": "e.g. john@example.com",
  "role.director": "Campaign Director",
  "role.lgaCoordinator": "LGA Coordinator",
  "role.wardCoordinator": "Ward Coordinator",
  "role.puAgent": "Polling-Unit Agent",
  "role.constituencyLead": "Constituency Lead",
  "territory.ward": "Ward",
  "territory.selectLgaFirst": "Select an LGA first.",
  "territory.selectWardFirst": "Select a ward first.",
  "action.reviewHeading": "Review",
  "org.territoryPrefix": "Territory:",
  "org.languageCapabilities": "Language capabilities",
  "org.noMembers": "No members to show.",
  "org.noLanguageCapability": "No declared language capability yet.",
  "org.whosInvolved": "Who's involved",
  "org.noTeamYet": "No team members yet.",
  "status.active": "ACTIVE",
  "org.invitationsHeading": "Invitations",
  "action.revoke": "Revoke",
  "org.needTerritoryFirst": "Set your territory in the Territory tab before inviting people.",

  // Places
  "territory.yourAssigned": "Your assigned territory",
  "territory.noWardsImported": "No wards imported yet for this LGA.",
  "territory.setYours": "Set your electoral territory",
  "territory.electionPlaceholder": "e.g. 2027 General Election",
  "territory.office": "Office",
  "territory.state": "State",
  "territory.constituency": "Constituency",
  "territory.lgas": "Local Government Areas",
  "action.assign": "Assign",
  "territory.lgaCoordinatorsHeading": "LGA coordinators",
  "territory.wardCoordinatorsHeading": "Ward coordinators",

  // Work
  "mobilize.fieldRoster": "Field roster",
  "mobilize.noPeopleYet": "No people added yet.",
  "action.addPerson": "Add person",
  "mobilize.assignments": "Assignments",
  "mobilize.noAssignmentsYet": "No assignments recorded yet.",
  "action.changeAssignmentStatus": "Change assignment status",
  "action.createAssignment": "Create assignment",
  "mobilize.tasks": "Tasks",
  "mobilize.noTasksYet": "No tasks created yet.",
  "action.changeTaskStatus": "Change task status",
  "action.createTask": "Create task",
  "mobilize.agentCoverage": "Agent coverage by geography",
  "territory.national": "National",

  // Election Operations
  "electionDay.coverageHeading": "Coverage — state / LGA / ward / polling unit",
  "electionDay.noPuYet": "No polling units added yet.",
  "action.addPollingUnit": "Add polling unit",
  "electionDay.puAgentsHeading": "Polling-unit agents",
  "electionDay.noAgentsYet": "No agents assigned yet.",
  "action.changeAgentStatus": "Change agent status",
  "action.assignAgent": "Assign agent",
  "electionDay.evidencePhotoAlt": "Result-sheet evidence photo",
  "electionDay.puSelect": "Polling unit",
  "electionDay.noPuAddOneFirst": "No polling units yet — add one first",
  "electionDay.extractedFields": "Extracted fields (manual entry)",
  "electionDay.verificationDecision": "Verification decision",
  "electionDay.resultsHeading": "Results (simulation)",
  "electionDay.noResultsYet": "No results captured yet.",
  "action.verifyResult": "Verify result",
  "electionDay.captureResult": "Capture result",
  "electionDay.incidentLog": "Incident log",
  "electionDay.noIncidentsYet": "No incidents reported.",
  "action.updateIncidentStatus": "Update incident status",
  "action.reportIncident": "Report incident",

  // Coordination
  "chat.coordinationRooms": "Coordination rooms",
  "chat.roomType": "Room type",
  "chat.newRoomName": "New room name",
  "chat.newRoomPlaceholder": "e.g. Ward 3 Coordination",
  "action.create": "Create",
  "chat.noMessagesYet": "No messages yet — say hello.",
  "chat.referenceType": "Reference type",
  "chat.referenceIdPlaceholder": "its id",
  "chat.referenceId": "Reference id",
  "chat.messagePlaceholder": "Write a message…",
  "chat.message": "Message",
  "action.send": "Send",
  "chat.roomsHeading": "Rooms",
  "chat.conversationHeading": "Conversation",
  "chat.communications": "Communications",

  // Studio
  "studio.noAiImageDisclosure": "Text/colour only — no AI image generation connected",
  "studio.assetTitle": "Asset title",
  "studio.templatesHeading": "Templates",
  "studio.yourAssets": "Your assets",
  "studio.noAssetsYet": "No assets yet — choose a template to start one.",
  "studio.editorHeading": "Editor",
  "studio.chooseTemplate": "Choose a template or open a saved asset to start editing.",
  "studio.family": "Family",
  "studio.languageHeading": "Language",
  "studio.interfaceLanguage": "Interface",
  "studio.aiInteractionLanguage": "Talk to AI in",
  "studio.creativeOutputLanguage": "Graphic text in",
  "studio.opacity": "Opacity",
  "studio.noPhotoAdded": "No photo added",
  "studio.creativeCommandPlaceholder": "e.g. \"center the headline\"",

  // Ask ElectionCanon
  "ask.answerHeading": "Answer",
  "ask.nextActionHeading": "Next action",
  "ask.groundedInCanon": "Grounded in your campaign's own recorded data.",
  "ask.seeCanon": "See Canon →",
  "ask.inputPlaceholder": "Ask ElectionCanon…",
  "ask.askButton": "Ask",
  "ask.asking": "Asking…",
  "ask.scopedQuestionGuidance": "Ask a question scoped only to this campaign's own ElectionCanon data. English only this Alpha; other languages are recognised and answered in English with that noted, never a fabricated translation.",
  "voice.comingSoon": "Voice · soon",
  "ask.alerts": "Alerts",
  "ask.noOpenAlerts": "No open alerts.",
  "ask.coverageGaps": "Coverage gaps",
  "ask.wardCoverage": "Ward coverage",
  "ask.taskBottlenecks": "Task bottlenecks",
  "ask.electionDaySimStats": "Election-day simulation statistics",
  "ask.activityTrend": "Activity trend",

  // Canon
  "canon.filterByCategory": "Filter by category",
  "canon.whenLabel": "When:",
  "canon.whereLabel": "Where:",
  "canon.statusLabel": "Status:",
  "canon.recordLabel": "Record:",

  // Readiness
  "readiness.claimsHeading": "Readiness claims (CANON)",
  "readiness.knownWardCoverage": "Known ward coverage",
  "readiness.gapsHeading": "Gaps (CANON-derived)",
  "readiness.notTrackedYet": "Not yet tracked by ElectionCanon.",
  "readiness.countTemplate.people": "{count} in the roster.",
  "readiness.countTemplate.wards": "{wardCount} known · {coordinatorCount} with a coordinator.",
  "readiness.countTemplate.pollingUnits": "{count} configured. See Election Day.",
  "readiness.countTemplate.agents": "{count} assigned across polling units.",
  "readiness.countTemplate.assignmentsTasks": "{assignmentCount} assignment(s) · {taskCount} task(s) recorded. See Mobilize.",
  "readiness.countTemplate.results": "{count} simulated result(s) captured. See Election Day.",
  "readiness.countTemplate.incidents": "{count} incident(s) logged, {unresolved} unresolved.",
  "home.nextActionCandidateRegistered": "Complete candidate registration.",
  "home.nextActionWardAssignment": "Prepare your first ward.",
  "home.nextActionWardStatusHealth": "Report a ward's current status.",
  "home.nextActionObserverAssignment": "Assign your first observer.",
  "home.nextActionReviewGaps": "Review your readiness gaps.",

  // System / Welcome / candidate registration
  "welcome.heading": "Welcome",
  "welcome.availableNow": "Available now",
  "welcome.comingNext": "Coming next",
  "welcome.setUpWorkspace": "Set up your election workspace",
  "candidate.completeRegistration": "Complete candidate registration",
  "candidate.alreadySetOnTerritory": "Already set on Territory — not asked again here.",
  "candidate.namePlaceholder": "Candidate's full name",
  "candidate.party": "Party",

  // Communications
  "comms.revocationReason": "Reason for revoking…",
  "comms.revocationReasonLabel": "Revocation reason",
  "comms.yourReview": "Your review",
  "comms.reviewNotes": "Notes (required if rejecting)",
  "comms.brief": "Brief",
  "comms.briefGuidance": "Internal context for the communication. It is not itself reviewed or approved.",
  "comms.masterText": "Master text",
  "action.saveBriefMasterText": "Save brief / master text",
  "comms.noAssetsAttached": "No assets attached yet.",
  "comms.attachAsset": "Attach a Studio asset",
  "action.attach": "Attach",
  "comms.addLanguageVariant": "Add a language variant",
  "comms.variantText": "Variant text",
  "action.addVariant": "Add variant",
  "comms.newTitlePlaceholder": "New communication title",
  "comms.noCommsYet": "No communications yet — create one to start planning.",
  "comms.detailHeading": "Detail",
  "comms.chooseCommGuidance": "Choose a communication to see its linked assets and language variants.",

  // ---- VISIBILITY EXPANSION PASS — public landing page (Landing.jsx had
  // ZERO t() call sites before this pass; see docs/multilingual/
  // UI-STRING-INVENTORY.md's addendum for the full before/after audit).
  // Civic/technical nouns that already have an established translation
  // elsewhere in this file are deliberately REUSED via their existing key
  // (territory.office, territory.constituency, nav.readiness, nav.chat,
  // role.lgaCoordinator/wardCoordinator/puAgent, nav.canon) rather than
  // redeclared here — same "reuse the existing registry" discipline as
  // the rest of this codebase.
  "landing.heroHeadline": "The operating system for running an election campaign.",
  "landing.heroSubheadline": "From campaign command to polling unit, everyone knows what they are responsible for, where they are responsible, and what still needs to be done.",
  "landing.heroBody": "ElectionCanon replaces fragmented campaign coordination — scattered chats, calls, and spreadsheets — with one accountable operational system: territory, organisation, responsibility, readiness, and coordination, all built on a single event-sourced record that every screen reads from.",
  "landing.ctaStart": "Start a Campaign →",
  "landing.ctaHowItWorks": "See How It Works →",

  "landing.problemKicker": "The Problem",
  "landing.problemHeading": "Campaign coordination is usually scattered across a dozen different places.",
  "landing.problemBody": "None of this means a campaign isn't working hard — it means the work has nowhere shared to live. ElectionCanon is the infrastructure that brings it together: one record everyone in the campaign can trust, instead of a dozen scattered ones nobody fully sees.",
  "landing.problemTag.whatsapp": "WhatsApp groups",
  "landing.problemTag.calls": "Phone calls",
  "landing.problemTag.spreadsheets": "Spreadsheets",
  "landing.problemTag.volunteers": "Scattered volunteers",
  "landing.problemTag.responsibility": "Unclear responsibility",
  "landing.problemTag.territory": "Unknown territory coverage",
  "landing.problemTag.mobilisation": "Last-minute mobilisation",

  "landing.canonKicker": "The Canon",
  "landing.canonHeading": "Every action leaves a record.",
  "landing.canonBody": "ElectionCanon calls this record the Canon — a single, tenant-isolated history that every screen reads from and every action writes to. Assign a ward. Report readiness. Send a message. Each becomes a permanent, attributed fact, not a claim that quietly disappears into someone's phone.",
  "landing.chainAction": "Action",
  "landing.chainEvent": "Event",
  "landing.chainRecord": "Record",

  "landing.howItWorksKicker": "How ElectionCanon Works",
  "landing.howItWorksHeading": "From election to election day, in one continuous system.",
  "landing.step.election": "Election",
  "landing.step.territory": "Territory",
  "landing.step.organisation": "Organisation",
  "landing.step.responsibility": "Responsibility",
  "landing.step.electionDay": "Election Day",

  "landing.hierarchyKicker": "From Campaign Command to Polling Unit",
  "landing.hierarchyHeading": "Every person gets a real operational responsibility — not just another name in a group chat.",
  "landing.hierarchy.command": "Campaign Command",

  "landing.workspaceKicker": "Campaign Studio",
  "landing.workspaceHeading": "Everything the campaign needs, in one operational workspace.",

  "landing.differenceKicker": "The Difference",
  "landing.differenceHeading": "ElectionCanon connects the things that usually stay disconnected.",

  "landing.existsKicker": "What Exists Today",
  "landing.existsHeading": "Operational, simulated, and in development — never blurred together.",
  "landing.categoryOperational": "Operational",
  "landing.categoryInDevelopment": "In Development",

  "landing.architectureKicker": "Architecture",
  "landing.architectureHeading": "Rooms read. Events write.",

  "landing.openSourceKicker": "Open Source",
  "landing.openSourceHeading": "Inspect the machine.",
  "landing.openSourceBody1": "ElectionCanon is licensed under AGPL-3.0 — read it, run it locally, question it, and improve it. Election infrastructure should be inspectable by the people who rely on it, not a black box.",
  "landing.openSourceBody2": "Build with us. An independent, ElectionCanon-controlled public repository is now live. Read it, run it locally, question it, and contribute as the project develops.",

  "landing.whoKicker": "Who It Is For",
  "landing.audience.candidate": "Candidate campaigns",
  "landing.audience.directors": "Campaign directors",
  "landing.audience.coordinators": "Field coordinators",
  "landing.audience.volunteers": "Volunteers",
  "landing.audience.observers": "Observer / monitoring organisations",
  "landing.audience.opsTeams": "Election operations teams",
  "landing.nonAffiliation": "ElectionCanon does not run for or against any party or candidate, and its use implies no endorsement by, or affiliation with, any electoral authority or government body.",

  "landing.startKicker": "Start",
  "landing.startHeading": "Create your ElectionCanon campaign.",
  "landing.startBody": "Create an account, establish your campaign, select your election, office, and constituency, and begin building your organisation — from campaign command down to the polling unit.",

  "landing.footerCopyright": "ElectionCanon — open source under AGPL-3.0.",
  "landing.viewSourceCta": "View source on GitHub →",

  // ---- VISIBILITY EXPANSION PASS — highest-visibility operational Home
  // strings that were still hardcoded English JSX (HomeSection.jsx already
  // had 24 t() call sites before this pass; these fill the remaining
  // high-visibility gaps — the primary "what to do next" button, the
  // all-clear/attention-tone labels, and the per-alert action labels).
  // Does NOT touch the plural-grammar-bearing count sentences (StatusRow
  // detail text, "N of M wards still need…") — same deferral reasoning as
  // readiness.countTemplate.* above.
  "home.continuePreparation": "Continue Preparation →",
  "home.allClear": "ALL CLEAR — nothing needs attention right now.",
  "home.toneUrgent": "Urgent",
  "home.toneWatch": "Watch",
  "action.inviteSomeone": "Invite someone",
  "home.viewAllEventsCanon": "View all events — Canon →",
  "home.noActiveResponsibilityBody1": "No active responsibility was found for this account.",
  "home.noActiveResponsibilityBody2": "Contact your campaign owner if you believe this is a mistake — they can assign or reassign a responsibility from Organisation or Territory.",
  "home.observerOrgLabel": "Observer / monitoring organisation",
  "home.candidateCampaignLabel": "Candidate campaign",
  "home.readinessAllComplete": "Every tracked readiness dimension is COMPLETE. Check Election Day for the next step.",

  // ---- SAFETY-GATED (see SAFETY_GATED_KEYS below) ----
  "electionDay.simDisclosure": "Simulation / demonstration data — not official election results",
  "electionDay.simPhotoDisclosure": "Simulation content — real photo upload, not an official result",
  "electionDay.simResultsDisclosure": "Simulated election data — not official results",
  "ask.languageFallbackBanner": "Answered in English — this language is still under native-speaker review and does not yet have its own Ask ElectionCanon responses.",
});

// ---------- NIGERIAN PIDGIN — fullest non-English draft (same reasoning
// as pidgin/responses.js: closest to English, project's own prior research
// singles it out as most tractable). AI_DRAFTED, not native-reviewed.
const pcm = Object.freeze({
  "nav.home": "Summary",
  "nav.organisation": "People",
  "nav.territory": "Places",
  "nav.mobilize": "Work",
  "nav.electionDay": "Election Operations",
  "nav.chat": "Coordination",
  "nav.studio": "Studio",
  "nav.intelligence": "Ask ElectionCanon",
  "nav.canon": "Canon",
  "nav.readiness": "Readiness",
  "nav.settings": "System",
  "nav.drawerHeading": "Navigate",
  "action.signOut": "Sign out",
  "status.proposedNotRecorded": "Action wey we propose — e never record",
  "action.cancel": "Cancel",
  "action.done": "Done",
  "action.back": "Back",
  "action.create": "Create",
  "action.send": "Send",
  "action.revoke": "Revoke",
  "action.assign": "Assign",
  "action.attach": "Attach",
  "action.confirmHeading": "Confirm",
  "action.reviewHeading": "Review",
  "action.prepare": "Prepare",
  "action.preparing": "Dey prepare…",
  "action.approve": "Approve",
  "action.recording": "Dey record…",
  "common.reason": "Reason",
  "home.yourScope": "Your scope",
  "home.yourElection": "Your election",
  "home.noActiveResponsibility": "No active responsibility",
  "home.whatNeedsAttention": "Wetin need attention today",
  "home.whatChanged": "Wetin change",
  "home.noActivityYet": "No organisation activity dey record yet.",
  "home.yourWards": "Your wards",
  "home.yourPollingUnits": "Your polling units",
  "coverage.heading": "Coverage",
  "territory.noPuImportedWard": "No polling unit import yet for this ward.",
  "role.lgaCoordinator": "LGA Coordinator",
  "role.wardCoordinator": "Ward Coordinator",
  "role.puAgent": "Polling-Unit Agent",
  "role.constituencyLead": "Constituency Lead",
  "org.whosInvolved": "People wey dey involved",
  "org.noTeamYet": "No team member yet.",
  "org.noMembers": "No members to show.",
  "org.invitationsHeading": "Invitations",
  "org.needTerritoryFirst": "Set your territory for Territory tab before you invite people.",
  "territory.yourAssigned": "Your territory wey dem assign",
  "territory.setYours": "Set your electoral territory",
  "territory.office": "Office",
  "territory.state": "State",
  "territory.constituency": "Constituency",
  "territory.lgas": "Local Government Areas",
  "mobilize.fieldRoster": "Pipo For Field",
  "mobilize.noPeopleYet": "No people add yet.",
  "mobilize.assignments": "Assignments",
  "mobilize.noAssignmentsYet": "No assignment dey record yet.",
  "mobilize.tasks": "Tasks",
  "mobilize.noTasksYet": "No task create yet.",
  "mobilize.agentCoverage": "Agent coverage by geography",
  "territory.national": "National",
  "electionDay.noPuYet": "No polling unit add yet.",
  "electionDay.puAgentsHeading": "Polling-unit agent dem",
  "electionDay.noAgentsYet": "No agent assign yet.",
  "electionDay.resultsHeading": "Results (simulation)",
  "electionDay.noResultsYet": "No result capture yet.",
  "electionDay.captureResult": "Capture result",
  "electionDay.incidentLog": "Incident log",
  "electionDay.noIncidentsYet": "No incident report.",
  "chat.coordinationRooms": "Coordination Room Dem",
  "chat.noMessagesYet": "No message yet — say hello.",
  "chat.messagePlaceholder": "Write message…",
  "chat.message": "Message",
  "chat.roomsHeading": "Rooms",
  "chat.conversationHeading": "Conversation",
  "chat.communications": "Communications",
  "studio.templatesHeading": "Templates",
  "studio.yourAssets": "Your assets",
  "studio.noAssetsYet": "No assets yet — choose template to start one.",
  "studio.editorHeading": "Editor",
  "ask.alerts": "Alerts",
  "ask.noOpenAlerts": "No open alert.",
  "ask.coverageGaps": "Coverage gaps",
  "ask.wardCoverage": "Ward coverage",
  "ask.taskBottlenecks": "Task bottlenecks",
  "ask.activityTrend": "Activity trend",
  "canon.whenLabel": "Wen:",
  "canon.whereLabel": "Wia:",
  "canon.statusLabel": "Status:",
  "canon.recordLabel": "Record:",
  "readiness.claimsHeading": "Readiness claim dem (CANON)",
  "readiness.knownWardCoverage": "Ward coverage wey we sabi",
  "readiness.gapsHeading": "Gaps (CANON-derived)",
  "readiness.notTrackedYet": "ElectionCanon never track am yet.",
  "welcome.heading": "Welcome",
  "welcome.availableNow": "Wey dey available now",
  "welcome.comingNext": "Wey dey come next",
  "candidate.completeRegistration": "Complete candidate registration",
  "candidate.party": "Party",

  // ---- Pass 2 additions ----
  "a11y.closeAsk": "Close Ask ElectionCanon",
  "a11y.navDialog": "Main navigation",
  "a11y.navMenuClose": "Close navigation menu",
  "a11y.navMenuOpen": "Open navigation menu",
  "a11y.primaryNav": "Main",
  "action.addPerson": "Add person",
  "action.addVariant": "Add variant",
  "action.changeAssignmentStatus": "Change assignment status",
  "action.changeTaskStatus": "Change task status",
  "action.createAssignment": "Create assignment",
  "action.createTask": "Create task",
  "action.openChat": "Open Chat",
  "action.openElectionDay": "Open Election Day",
  "action.openMobilize": "Open Mobilize",
  "action.openReadiness": "Open Readiness",
  "action.openStudio": "Open Studio",
  "action.saveBriefMasterText": "Save brief / master text",
  "ask.answerHeading": "Ansa",
  "ask.askButton": "Ask",
  "ask.asking": "Dey ask…",
  "ask.electionDaySimStats": "Election-day simulation statistics",
  "ask.groundedInCanon": "E dey based on your campaign own record.",
  "ask.inputPlaceholder": "Ask ElectionCanon…",
  "ask.languageFallbackBanner": "We answer am for English — dis language still dey under native-speaker review, e no get its own Ask ElectionCanon answers yet.",
  "ask.nextActionHeading": "Next action",
  "ask.recordActionHeading": "Record one campaign action",
  "ask.recordActionPlaceholder": "like \"Assign Team 6 to Ward 6\" or \"Report Ward 6 as on-track\"",
  "ask.scopedQuestionGuidance": "Ask question wey concern only dis campaign own ElectionCanon data. Na English only for dis Alpha; we sabi other languages, we go answer dem for English and talk say na so, we no go fake translate am.",
  "ask.seeCanon": "See Canon →",
  "candidate.alreadySetOnTerritory": "Dem already set am for Territory — we no go ask again here.",
  "candidate.namePlaceholder": "Candidate full name",
  "canon.filterByCategory": "Filter by category",
  "chat.newRoomName": "New room name",
  "chat.newRoomPlaceholder": "like Ward 3 Coordination",
  "chat.referenceId": "Reference id",
  "chat.referenceIdPlaceholder": "its id",
  "chat.referenceType": "Reference type",
  "chat.roomType": "Room type",
  "comms.addLanguageVariant": "Add language variant",
  "comms.attachAsset": "Attach Studio asset",
  "comms.brief": "Brief",
  "comms.briefGuidance": "Internal gist for dis communication. Dem no dey review or approve am by itself.",
  "comms.chooseCommGuidance": "Choose communication to see the things wey attach to am and language variant.",
  "comms.detailHeading": "Detail",
  "comms.masterText": "Master text",
  "comms.newTitlePlaceholder": "New communication title",
  "comms.noAssetsAttached": "No asset attach yet.",
  "comms.noCommsYet": "No communication yet — create one to start planning.",
  "comms.reviewNotes": "Notes (you must talk am if you dey reject)",
  "comms.revocationReason": "Reason for revoke…",
  "comms.revocationReasonLabel": "Revocation reason",
  "comms.variantText": "Variant text",
  "comms.yourReview": "Your own review",
  "electionDay.coverageHeading": "Coverage — state / LGA / ward / polling unit",
  "electionDay.simDisclosure": "Simulation / demo data — na NOT official election result",
  "electionDay.simPhotoDisclosure": "Simulation content — na real photo wey dem upload, but na NOT official result",
  "electionDay.simResultsDisclosure": "Simulated election data — na NOT official result",
  "home.coverageLgasWards": "Coverage — LGAs and wards",
  "home.electionDayLabel": "Election Day",
  "home.mobilizationLabel": "Mobilization",
  "home.operationalStatus": "Operational status",
  "home.studioLabel": "Campaign Studio",
  "home.whatToDoNext": "Wetin to do next",
  "org.email": "Email",
  "org.emailPlaceholder": "like john@example.com",
  "org.invitationCreated": "Invitation don create",
  "org.languageCapabilities": "Language wey person sabi",
  "org.name": "Name",
  "org.namePlaceholder": "like John Doe",
  "org.noLanguageCapability": "No language wey dem talk person sabi yet.",
  "org.territoryPrefix": "Territory:",
  "responsibility.newPerson": "New person wey go responsible",
  "responsibility.reasonPlaceholder": "like E relocate, e step back, e fit dis ward well well",
  "role.director": "Campaign Director",
  "status.active": "ACTIVE",
  "studio.aiInteractionLanguage": "Talk to AI for",
  "studio.creativeCommandPlaceholder": "like \"put the headline for middle\"",
  "studio.creativeOutputLanguage": "Graphic text for",
  "studio.family": "Family",
  "studio.interfaceLanguage": "Interface",
  "studio.languageHeading": "Langwej",
  "studio.noAiImageDisclosure": "Na text/colour only — no AI image generation dey connect",
  "studio.noPhotoAdded": "No photo add",
  "studio.opacity": "Opacity",
  "territory.electionPlaceholder": "like 2027 General Election",
  "territory.lgaCoordinatorsHeading": "LGA coordinators",
  "territory.noLgasWardsYet": "No LGA or ward wey we sabi for dis campaign territory yet.",
  "territory.noWardsImported": "No ward wey dem import yet for dis LGA.",
  "territory.selectLgaFirst": "Select LGA first.",
  "territory.selectWardFirst": "Select ward first.",
  "territory.ward": "Ward",
  "territory.wardCoordinatorsHeading": "Ward coordinators",
  "voice.comingSoon": "Voice · soon",
  "welcome.setUpWorkspace": "Set up your election workspace",
  "home.nextActionCandidateRegistered": "Finish candidate registration.",
  "home.nextActionWardAssignment": "Get your first ward ready.",
  "home.nextActionWardStatusHealth": "Report how one ward dey now.",
  "home.nextActionObserverAssignment": "Give your first observer work.",
  "home.nextActionReviewGaps": "Check your readiness gap dem.",

  // ---- VISIBILITY EXPANSION PASS (landing + home) ----
  "landing.heroHeadline": "Di operating system wey go run election campaign.",
  "landing.heroSubheadline": "From campaign command reach polling unit, everybody sabi wetin dem responsible for, wia dem responsible, and wetin still dey remain to do.",
  "landing.heroBody": "ElectionCanon dey replace scatter-scatter campaign coordination — chat wey scatter, call, and spreadsheet — with one system wey get accountability: territory, organisation, responsibility, readiness, and coordination, all of dem build on one event-sourced record wey every screen dey read from.",
  "landing.ctaStart": "Start Your Campaign →",
  "landing.ctaHowItWorks": "See How E Dey Work →",
  "landing.problemKicker": "Di Problem",
  "landing.problemHeading": "Most time, how campaign dey organize dey scatter for like twelve different place.",
  "landing.problemBody": "Dis one no mean say di campaign no dey try — e mean say di work no get one common place wey e dey stay. ElectionCanon na di system wey dey bring everything together: one record wey everybody for di campaign fit trust, instead of plenty scatter record wey nobody fit see well well.",
  "landing.problemTag.whatsapp": "WhatsApp group",
  "landing.problemTag.calls": "Phone call",
  "landing.problemTag.spreadsheets": "Spreadsheet",
  "landing.problemTag.volunteers": "Volunteer wey scatter",
  "landing.problemTag.responsibility": "Responsibility wey no clear",
  "landing.problemTag.territory": "Territory coverage wey nobody sabi",
  "landing.problemTag.mobilisation": "Last-minute mobilization",
  "landing.canonKicker": "Di Canon",
  "landing.canonHeading": "Every action dey leave record.",
  "landing.canonBody": "ElectionCanon dey call dis record Canon — na one history, wey dem separate for each campaign, wey every screen dey read from and every action dey write go inside. Assign ward. Report how prepare dem prepare. Send message. Everyone go become permanent fact, wey dem attach to who do am, no be claim wey go just disappear for person phone.",
  "landing.chainAction": "Action",
  "landing.chainEvent": "Event",
  "landing.chainRecord": "Record",
  "landing.howItWorksKicker": "How ElectionCanon Dey Work",
  "landing.howItWorksHeading": "From election reach election day, inside one system wey no dey stop.",
  "landing.step.election": "Election",
  "landing.step.territory": "Territory",
  "landing.step.organisation": "Organisation",
  "landing.step.responsibility": "Responsibility",
  "landing.step.electionDay": "Election Day",
  "landing.hierarchyKicker": "From Campaign Command Reach Polling Unit",
  "landing.hierarchyHeading": "Everybody dey get real work wey dem responsible for — no be just another name for group chat.",
  "landing.hierarchy.command": "Campaign Command",
  "landing.workspaceKicker": "Campaign Studio",
  "landing.workspaceHeading": "Everything wey di campaign need, for one work space.",
  "landing.differenceKicker": "Di Difference",
  "landing.differenceHeading": "ElectionCanon dey connect di things wey normally no dey connect.",
  "landing.existsKicker": "Wetin Dey Now",
  "landing.existsHeading": "E dey work, e be simulation, or e still dey develop — we no dey mix dem up.",
  "landing.categoryOperational": "E Dey Work",
  "landing.categoryInDevelopment": "E Still Dey Develop",
  "landing.architectureKicker": "Architecture",
  "landing.architectureHeading": "Room dey read. Event dey write.",
  "landing.openSourceKicker": "Open Source",
  "landing.openSourceHeading": "Check di machine well well.",
  "landing.openSourceBody1": "ElectionCanon get license under AGPL-3.0 — read am, run am for your own machine, ask am question, and make am better. Election infrastructure suppose be something wey di people wey dey depend on am fit check, e no suppose be black box wey nobody fit see inside.",
  "landing.openSourceBody2": "Build am join us. Independent, public repository wey ElectionCanon dey control don dey live now. Read am, run am for your own machine, ask am question, and contribute as di project dey grow.",
  "landing.whoKicker": "Who Dis Be For",
  "landing.audience.candidate": "Candidate campaign",
  "landing.audience.directors": "Campaign director",
  "landing.audience.coordinators": "Field coordinator",
  "landing.audience.volunteers": "Volunteer",
  "landing.audience.observers": "Observer / monitoring organisation",
  "landing.audience.opsTeams": "Election operations team",
  "landing.nonAffiliation": "ElectionCanon no dey support or fight any party or candidate, and if you use am, e no mean say any election body or government don support am or join hand with am.",
  "landing.startKicker": "Start",
  "landing.startHeading": "Create your ElectionCanon campaign.",
  "landing.startBody": "Create account, set up your campaign, choose your election, office, and constituency, and start to build your organisation — from campaign command reach polling unit.",
  "landing.footerCopyright": "ElectionCanon — open source under AGPL-3.0.",
  "landing.viewSourceCta": "See di source for GitHub →",
  "home.continuePreparation": "Continue Di Preparation →",
  "home.allClear": "EVERYTHING CLEAR — nothing no need attention right now.",
  "home.toneUrgent": "Urgent",
  "home.toneWatch": "Watch",
  "action.inviteSomeone": "Invite person",
  "home.viewAllEventsCanon": "See all event dem — Canon →",
  "home.noActiveResponsibilityBody1": "No active responsibility dey for dis account.",
  "home.noActiveResponsibilityBody2": "Contact your campaign owner if you feel say na mistake — dem fit assign or reassign responsibility from People or Places.",
  "home.observerOrgLabel": "Observer / monitoring organisation",
  "home.candidateCampaignLabel": "Candidate campaign",
  "home.readinessAllComplete": "Every readiness part wey dem dey track DON COMPLETE. Check Election Day for di next step.",
});

// ---------- HAUSA, IGBO, YORUBA — same terminology conventions already
// established for the 27 Ask ElectionCanon templates (ElectionCanon/Canon/
// ward/polling unit/LGA/campaign/incident/OCR retained in English, per
// each language's own technical.js convention; role.* titles — LGA
// Coordinator, Ward Coordinator, Polling-Unit Agent, Campaign Director,
// Constituency Lead — kept English the same way). AI_DRAFTED, not
// native-reviewed. Covers every key the real wired UI consumes except the
// seven pluralization-deferred readiness.countTemplate.* keys — see
// INTENTIONAL_FALLBACKS below for exactly which keys fall back to English
// in each language, and why.
const ha = Object.freeze({
  "nav.home": "Bayyani",
  "nav.organisation": "Mutane",
  "nav.territory": "Wurare",
  "nav.mobilize": "Aiki",
  "nav.electionDay": "Ayyukan Zabe",
  "nav.chat": "Hadin kai",
  "nav.studio": "Studio",
  "nav.intelligence": "Tambayi ElectionCanon",
  "nav.canon": "Canon",
  "nav.readiness": "Shiri",
  "nav.settings": "Tsarin",
  "action.signOut": "Fita",
  "action.cancel": "Soke",
  "action.done": "An gama",
  "action.back": "Baya",
  "action.create": "Kirkiro",
  "action.send": "Aika",
  "action.revoke": "Soke izini",
  "action.assign": "Ba da aiki",
  "common.reason": "Dalili",
  "home.yourScope": "Yankinku",
  "home.yourElection": "Zaben ku",
  "home.whatNeedsAttention": "Abin da ke bukatar kulawa yau",
  "home.whatChanged": "Abin da ya canza",
  "home.yourWards": "Wardsin ku",
  "home.yourPollingUnits": "Polling unitsin ku",
  "coverage.heading": "Rufi",
  "role.lgaCoordinator": "LGA Coordinator",
  "role.wardCoordinator": "Ward Coordinator",
  "role.puAgent": "Polling-Unit Agent",
  "org.whosInvolved": "Wadanda ke ciki",
  "org.noTeamYet": "Babu wata kungiya tukuna.",
  "org.invitationsHeading": "Gayyata",
  "territory.office": "Mukami",
  "territory.state": "Jiha",
  "territory.constituency": "Mazaɓa",
  "territory.lgas": "Kananan Hukumomi",
  "mobilize.fieldRoster": "Jerin ma'aikata",
  "mobilize.assignments": "Ayyukan da aka ba",
  "mobilize.tasks": "Ayyuka",
  "electionDay.puAgentsHeading": "Wakilan polling unit",
  "electionDay.resultsHeading": "Sakamako (kwaikwayo)",
  "electionDay.captureResult": "Kama sakamako",
  "electionDay.incidentLog": "Rajistan abubuwan da suka faru",
  "chat.coordinationRooms": "Dakunan hadin kai",
  "chat.roomsHeading": "Dakuna",
  "chat.conversationHeading": "Tattaunawa",
  "chat.communications": "Sadarwa",
  "studio.templatesHeading": "Samfura",
  "studio.yourAssets": "Kayanku",
  "studio.editorHeading": "Mai gyarawa",
  "ask.alerts": "Gargadi",
  "ask.coverageGaps": "Giɓin rufi",
  "ask.wardCoverage": "Rufin ward",
  "readiness.claimsHeading": "Da'awar shiri (CANON)",
  "welcome.heading": "Barka da zuwa",

  // ---- Pass 2 additions ----
  "a11y.closeAsk": "Rufe Tambayi ElectionCanon",
  "ask.activityTrend": "Yanayin ayyuka",
  "home.noActiveResponsibility": "Babu alhakin aiki a yanzu",
  "home.noActivityYet": "Babu ayyukan ƙungiya da aka rubuta tukuna.",
  "home.operationalStatus": "Matsayin ayyuka",
  "readiness.gapsHeading": "Giɓi (daga CANON)",
  "readiness.knownWardCoverage": "Rufin ward da aka sani",
  "readiness.notTrackedYet": "ElectionCanon bai bi diddigin wannan tukuna ba.",
  "territory.noPuImportedWard": "Babu polling unit da aka shigo da su tukuna domin wannan ward.",
  "territory.setYours": "Tsara yankin zaɓenku",
  "a11y.navDialog": "Babban kewayawa",
  "a11y.navMenuClose": "Rufe jerin kewayawa",
  "a11y.navMenuOpen": "Buɗe jerin kewayawa",
  "a11y.primaryNav": "Babba",
  "action.addPerson": "Ƙara mutum",
  "action.addVariant": "Ƙara sigar harshe",
  "action.approve": "Amince",
  "action.attach": "Liƙa",
  "action.changeAssignmentStatus": "Canza matsayin aikin da aka ba",
  "action.changeTaskStatus": "Canza matsayin aiki",
  "action.confirmHeading": "Tabbatarwa",
  "action.createAssignment": "Ƙirƙiri rabon aiki",
  "action.createTask": "Ƙirƙiri aiki",
  "action.openChat": "Buɗe Tattaunawa",
  "action.openElectionDay": "Buɗe Ayyukan Zabe",
  "action.openMobilize": "Buɗe Aiki",
  "action.openReadiness": "Buɗe Shiri",
  "action.openStudio": "Buɗe Studio",
  "action.prepare": "Shirya",
  "action.preparing": "Ana shiri…",
  "action.recording": "Ana rikodi…",
  "action.reviewHeading": "Bita",
  "action.saveBriefMasterText": "Ajiye taƙaitawa / babban rubutu",
  "ask.answerHeading": "Amsa",
  "ask.askButton": "Tambaya",
  "ask.asking": "Ana tambaya…",
  "ask.electionDaySimStats": "Kididdigar kwaikwayon ranar zabe",
  "ask.groundedInCanon": "An gina shi akan bayanan da campaign naku ya rubuta.",
  "ask.inputPlaceholder": "Tambayi ElectionCanon…",
  "ask.languageFallbackBanner": "An amsa cikin Ingilishi — ana ci gaba da nazarin wannan harshe daga masu ilimin harshen asali, kuma har yanzu babu amsoshin Tambayi ElectionCanon na kansa a cikinsa.",
  "ask.nextActionHeading": "Matakin gaba",
  "ask.noOpenAlerts": "Babu wani gargaɗi a buɗe.",
  "ask.recordActionHeading": "Rubuta wani aikin campaign",
  "ask.recordActionPlaceholder": "misali \"Ba da Team 6 ga Ward 6\" ko \"Ba da rahoton Ward 6 a kan turba\"",
  "ask.scopedQuestionGuidance": "Yi tambaya da ta shafi bayanan ElectionCanon na wannan campaign kawai. Ingilishi kawai a wannan Alpha; ana gane sauran harsuna kuma ana amsa su cikin Ingilishi tare da bayyana haka, ba tare da ƙirƙira fassarar ƙarya ba.",
  "ask.seeCanon": "Duba Canon →",
  "ask.taskBottlenecks": "Cikas a ayyuka",
  "candidate.alreadySetOnTerritory": "An tsara shi a Wurare tuni — ba za a sake tambaya a nan ba.",
  "candidate.completeRegistration": "Kammala rijistar ɗan takara",
  "candidate.namePlaceholder": "Cikakken sunan ɗan takara",
  "candidate.party": "Jam'iyya",
  "canon.filterByCategory": "Tace ta nau'i",
  "canon.recordLabel": "Rikodi:",
  "canon.statusLabel": "Matsayi:",
  "canon.whenLabel": "Lokacin:",
  "canon.whereLabel": "Inda:",
  "chat.message": "Sako",
  "chat.messagePlaceholder": "Rubuta sako…",
  "chat.newRoomName": "Sunan sabon daki",
  "chat.newRoomPlaceholder": "misali Hadin kan Ward 3",
  "chat.noMessagesYet": "Babu sako tukuna — ku fara sallama.",
  "chat.referenceId": "Lambar bayani",
  "chat.referenceIdPlaceholder": "lambarsa",
  "chat.referenceType": "Nau'in bayani",
  "chat.roomType": "Nau'in daki",
  "comms.addLanguageVariant": "Ƙara sigar harshe",
  "comms.attachAsset": "Liƙa kayan Studio",
  "comms.brief": "Taƙaitawa",
  "comms.briefGuidance": "Bayani na cikin gida domin sadarwar. Ba a bita ko amincewa da shi kansa ba.",
  "comms.chooseCommGuidance": "Zaɓi sadarwa domin ganin kayanta da sigoginta na harsuna.",
  "comms.detailHeading": "Bayani dalla-dalla",
  "comms.masterText": "Babban rubutu",
  "comms.newTitlePlaceholder": "Sunan sabuwar sadarwa",
  "comms.noAssetsAttached": "Babu wani kaya da aka liƙa tukuna.",
  "comms.noCommsYet": "Babu sadarwa tukuna — ƙirƙiri ɗaya domin shirya.",
  "comms.reviewNotes": "Bayani (dole ne idan ana ƙi)",
  "comms.revocationReason": "Dalilin soke izini…",
  "comms.revocationReasonLabel": "Dalilin soke izini",
  "comms.variantText": "Rubutun sigar",
  "comms.yourReview": "Bitar ku",
  "electionDay.coverageHeading": "Rufi — jiha / LGA / ward / polling unit",
  "electionDay.simDisclosure": "Bayanan kwaikwayo / nunawa ne — ba sakamakon zabe na hukuma ba",
  "electionDay.simPhotoDisclosure": "Abun kwaikwayo ne — hoto na gaske da aka tura, amma ba sakamako na hukuma ba",
  "electionDay.simResultsDisclosure": "Bayanan zaben kwaikwayo ne — ba sakamako na hukuma ba",
  "home.coverageLgasWards": "Rufi — LGA da wards",
  "home.electionDayLabel": "Ranar Zabe",
  "home.mobilizationLabel": "Mobilization",
  "home.studioLabel": "Campaign Studio",
  "home.whatToDoNext": "Abin da za ku yi na gaba",
  "mobilize.agentCoverage": "Rufin wakilai bisa yanki",
  "mobilize.noAssignmentsYet": "Babu rabon aiki da aka rubuta tukuna.",
  "mobilize.noPeopleYet": "Babu mutum da aka ƙara tukuna.",
  "mobilize.noTasksYet": "Babu aiki da aka ƙirƙira tukuna.",
  "nav.drawerHeading": "Kewayawa",
  "org.email": "Imel",
  "org.emailPlaceholder": "misali john@example.com",
  "org.invitationCreated": "An ƙirƙiri gayyata",
  "org.languageCapabilities": "Ƙwarewar harshe",
  "org.name": "Suna",
  "org.namePlaceholder": "misali John Doe",
  "org.needTerritoryFirst": "Ku tsara yankinku a shafin Wurare kafin ku gayyaci mutane.",
  "org.noLanguageCapability": "Babu wata ƙwarewar harshe da aka bayyana tukuna.",
  "org.noMembers": "Babu memba da za a nuna.",
  "org.territoryPrefix": "Yanki:",
  "responsibility.newPerson": "Sabon mai alhaki",
  "responsibility.reasonPlaceholder": "misali An koma wani wuri, ya janye, ya fi dacewa da wannan ward",
  "role.constituencyLead": "Constituency Lead",
  "role.director": "Campaign Director",
  "status.active": "MAI AIKI",
  "status.proposedNotRecorded": "Shawarar aiki — ba a rubuta ta tukuna ba",
  "studio.aiInteractionLanguage": "Yi magana da AI cikin",
  "studio.creativeCommandPlaceholder": "misali \"tsakaita kan labari\"",
  "studio.creativeOutputLanguage": "Rubutun hoto cikin",
  "studio.family": "Rukuni",
  "studio.interfaceLanguage": "Fuska",
  "studio.languageHeading": "Harshe",
  "studio.noAiImageDisclosure": "Rubutu/launuka kawai — babu haɗin ƙirƙirar hoto ta AI",
  "studio.noPhotoAdded": "Babu hoto da aka ƙara",
  "studio.opacity": "Opacity",
  "territory.electionPlaceholder": "misali Babban Zaben 2027",
  "territory.lgaCoordinatorsHeading": "Masu Kula da LGA",
  "territory.national": "Ƙasa",
  "territory.noLgasWardsYet": "Babu LGA ko ward da aka san su domin yankin wannan campaign tukuna.",
  "territory.noWardsImported": "Babu ward da aka shigo da su tukuna domin wannan LGA.",
  "territory.selectLgaFirst": "Ku zaɓi LGA tukuna.",
  "territory.selectWardFirst": "Ku zaɓi ward tukuna.",
  "territory.ward": "Ward",
  "territory.wardCoordinatorsHeading": "Masu Kula da Ward",
  "territory.yourAssigned": "Yankin da aka ba ku",
  "voice.comingSoon": "Murya · nan gaba",
  "welcome.availableNow": "Abin da ake da shi yanzu",
  "welcome.comingNext": "Abin da zai zo nan gaba",
  "welcome.setUpWorkspace": "Kafa wurin aikin zaɓenku",
  "home.nextActionCandidateRegistered": "Kammala rijistar ɗan takara.",
  "home.nextActionWardAssignment": "Shirya ward ɗinku na farko.",
  "home.nextActionWardStatusHealth": "Ba da rahoton halin yanzu na wani ward.",
  "home.nextActionObserverAssignment": "Ba da aiki ga mai sa ido naku na farko.",
  "home.nextActionReviewGaps": "Duba giɓin shirin ku.",

  // ---- VISIBILITY EXPANSION PASS (landing + home) ----
  "landing.heroHeadline": "Tsarin da ke gudanar da kamfen na zaɓe.",
  "landing.heroSubheadline": "Daga umarnin kamfen zuwa sashin zaɓe, kowa ya san abin da yake da alhakinsa, inda yake da alhakinsa, da kuma abin da har yanzu ake bukata a yi.",
  "landing.heroBody": "ElectionCanon tana maye gurbin tattara ayyukan kamfen da suka watse — tattaunawa, kira, da shafukan lissafi da suka warwatse — da tsari guda mai lissafi: yanki, ƙungiya, nauyi, shirye-shirye, da daidaitawa, duka an gina su a kan rikodi guda da kowace shafi ke karantawa daga ciki.",
  "landing.ctaStart": "Fara Kamfen →",
  "landing.ctaHowItWorks": "Duba Yadda Yake Aiki →",
  "landing.problemKicker": "Matsalar",
  "landing.problemHeading": "Yawanci, daidaita ayyukan kamfe yana watsuwa a wurare daban-daban guda goma sha biyu.",
  "landing.problemBody": "Wannan ba yana nufin kamfen ba ya aiki tuƙuru ba — yana nufin aikin ba shi da inda zai zauna tare. ElectionCanon shi ne tsarin da ke haɗa shi duka: rikodi ɗaya da kowa a cikin kamfen zai iya dogaro da shi, maimakon goma sha biyu da aka warwatsa wanda babu wanda ke ganin su duka.",
  "landing.problemTag.whatsapp": "Kungiyoyin WhatsApp",
  "landing.problemTag.calls": "Kiran waya",
  "landing.problemTag.spreadsheets": "Spreadsheets",
  "landing.problemTag.volunteers": "Masu sa kai warwatse",
  "landing.problemTag.responsibility": "Nauyi mara tabbas",
  "landing.problemTag.territory": "Rufin yanki da ba a sani ba",
  "landing.problemTag.mobilisation": "Tattara mutane na minti na ƙarshe",
  "landing.canonKicker": "Canon Ɗin",
  "landing.canonHeading": "Kowane aiki yana barin rikodi.",
  "landing.canonBody": "ElectionCanon yana kiran wannan rikodin da suna Canon — tarihi guda ɗaya, keɓaɓɓe ga kowane kamfen, wanda kowace shafi ke karantawa daga ciki kuma kowane aiki ke rubutawa zuwa ciki. Ba da alhakin ward. Bayar da rahoton shirye-shirye. Aika saƙo. Kowanne yana zama gaskiya ta dindindin, mai danganewa ga wanda ya yi shi, ba wai da'awar da take ɓacewa a wayar wani ba.",
  "landing.chainAction": "Aiki",
  "landing.chainEvent": "Lamari",
  "landing.chainRecord": "Rikodi",
  "landing.howItWorksKicker": "Yadda ElectionCanon Yake Aiki",
  "landing.howItWorksHeading": "Daga zaɓe zuwa ranar zaɓe, a cikin tsari guda mai ci gaba.",
  "landing.step.election": "Zaɓe",
  "landing.step.territory": "Yanki",
  "landing.step.organisation": "Ƙungiya",
  "landing.step.responsibility": "Nauyi",
  "landing.step.electionDay": "Ranar Zaɓe",
  "landing.hierarchyKicker": "Daga Umarnin Kamfen Zuwa Sashin Zaɓe",
  "landing.hierarchyHeading": "Kowane mutum yana samun ainihin nauyin aiki — ba kawai wani suna a cikin tattaunawar rukuni ba.",
  "landing.hierarchy.command": "Umarnin Kamfen",
  "landing.workspaceKicker": "Studio Kamfen",
  "landing.workspaceHeading": "Duk abin da kamfen yake bukata, a wuri guda na aiki.",
  "landing.differenceKicker": "Bambancin",
  "landing.differenceHeading": "ElectionCanon tana haɗa abubuwan da yawanci ke rarrabe.",
  "landing.existsKicker": "Abin da Ke Akwai Yanzu",
  "landing.existsHeading": "Mai aiki, kwaikwayo, da kuma cikin ci gaba — ba a taɓa gauraya su ba.",
  "landing.categoryOperational": "Mai Aiki",
  "landing.categoryInDevelopment": "Cikin Ci Gaba",
  "landing.architectureKicker": "Tsarin Gini",
  "landing.architectureHeading": "Dakuna suna karantawa. Abubuwan da suka faru suna rubutawa.",
  "landing.openSourceKicker": "Buɗaɗɗen Lamba",
  "landing.openSourceHeading": "Bincika na'urar.",
  "landing.openSourceBody1": "An ba ElectionCanon lasisi a ƙarƙashin AGPL-3.0 — karanta shi, gudanar da shi a gida, yi masa tambaya, kuma inganta shi. Ya kamata ababen more rayuwa na zaɓe su zama abin da mutanen da suka dogara da su za su iya duba su, ba akwatin baƙar fata ba.",
  "landing.openSourceBody2": "Gina tare da mu. Wani wuri na ajiya na jama'a, mai zaman kansa wanda ElectionCanon ke sarrafawa yanzu yana rayuwa. Karanta shi, gudanar da shi a gida, yi masa tambaya, kuma ba da gudummawa yayin da aikin ke ci gaba.",
  "landing.whoKicker": "Wadanda Wannan Ya Shafa",
  "landing.audience.candidate": "Kamfen ɗin 'yan takara",
  "landing.audience.directors": "Daraktocin kamfen",
  "landing.audience.coordinators": "Masu daidaita filin aiki",
  "landing.audience.volunteers": "Masu sa kai",
  "landing.audience.observers": "Kungiyoyin kallo / sa ido",
  "landing.audience.opsTeams": "Tawagogin ayyukan zaɓe",
  "landing.nonAffiliation": "ElectionCanon ba ya tsayawa don ko adawa da kowane jam'iyya ko ɗan takara, kuma amfani da shi ba yana nufin goyon baya daga, ko alaƙa da, kowace hukumar zaɓe ko hukumar gwamnati ba.",
  "landing.startKicker": "Fara",
  "landing.startHeading": "Ƙirƙiri kamfen ɗin ElectionCanon naka.",
  "landing.startBody": "Ƙirƙiri asusu, kafa kamfen ɗinka, zaɓi zaɓen ka, mukamin ka, da mazaɓarka, sannan ka fara gina ƙungiyarka — daga umarnin kamfen har zuwa sashin zaɓe.",
  "landing.footerCopyright": "ElectionCanon — buɗaɗɗen lamba a ƙarƙashin AGPL-3.0.",
  "landing.viewSourceCta": "Duba lambar a GitHub →",
  "home.continuePreparation": "Ci Gaba da Shiri →",
  "home.allClear": "BABU MATSALA — babu abin da ke buƙatar kulawa a yanzu.",
  "home.toneUrgent": "Gaggawa",
  "home.toneWatch": "Lura",
  "action.inviteSomeone": "Gayyaci wani",
  "home.viewAllEventsCanon": "Duba dukkan abubuwan da suka faru — Canon →",
  "home.noActiveResponsibilityBody1": "Ba a sami wani nauyi mai aiki ba ga wannan asusun.",
  "home.noActiveResponsibilityBody2": "Tuntuɓi mai kamfen ɗinka idan kana ganin wannan kuskure ne — zai iya ba da ko sake ba da nauyi daga Mutane ko Wurare.",
  "home.observerOrgLabel": "Kungiyar kallo / sa ido",
  "home.candidateCampaignLabel": "Kamfen ɗan takara",
  "home.readinessAllComplete": "Kowane bangare na shirye-shirye da ake bi ya KAMMALA. Duba Ranar Zaɓe don matakin gaba.",
});

const ig = Object.freeze({
  "nav.home": "Nchịkọta",
  "nav.organisation": "Ndị mmadụ",
  "nav.territory": "Ebe",
  "nav.mobilize": "Ọrụ",
  "nav.electionDay": "Ọrụ Ntuli Aka",
  "nav.chat": "Nkwekọrịta",
  "nav.studio": "Studio",
  "nav.intelligence": "Jụọ ElectionCanon",
  "nav.canon": "Canon",
  "nav.readiness": "Njikere",
  "nav.settings": "Sistemu",
  "action.signOut": "Pụọ",
  "action.cancel": "Kagbuo",
  "action.done": "Emechaala",
  "action.back": "Laghachi",
  "action.create": "Mepụta",
  "action.send": "Zipu",
  "action.revoke": "Kagbuo ikike",
  "action.assign": "Kenye",
  "common.reason": "Ihe kpatara",
  "home.yourScope": "Mpaghara gị",
  "home.yourElection": "Ntuli aka gị",
  "home.whatNeedsAttention": "Ihe chọrọ nlebara anya taa",
  "home.whatChanged": "Ihe gbanwere",
  "home.yourWards": "Ward gị",
  "home.yourPollingUnits": "Polling unit gị",
  "coverage.heading": "Mkpuchi",
  "role.lgaCoordinator": "LGA Coordinator",
  "role.wardCoordinator": "Ward Coordinator",
  "role.puAgent": "Polling-Unit Agent",
  "org.whosInvolved": "Ndị tinyere aka",
  "org.noTeamYet": "Enwebeghị otu ndị ọrụ.",
  "org.invitationsHeading": "Ọkpụkpọ",
  "territory.office": "Ọkwa",
  "territory.state": "Steeti",
  "territory.constituency": "Mpaghara ntuli aka",
  "territory.lgas": "Mpaghara Ọchịchị Ime Obodo",
  "mobilize.fieldRoster": "Ndepụta ndị ọrụ",
  "mobilize.assignments": "Ọrụ enyere",
  "mobilize.tasks": "Ọrụ",
  "electionDay.puAgentsHeading": "Ndị nnọchite polling unit",
  "electionDay.resultsHeading": "Nsonaazụ (nnomi)",
  "electionDay.captureResult": "Jide nsonaazụ",
  "electionDay.incidentLog": "Ndekọ ihe omume",
  "chat.coordinationRooms": "Ụlọ nkwekọrịta",
  "chat.roomsHeading": "Ụlọ",
  "chat.conversationHeading": "Mkparịta",
  "chat.communications": "Nzikọrịta ozi",
  "studio.templatesHeading": "Ụdị",
  "studio.yourAssets": "Ihe onwunwe gị",
  "studio.editorHeading": "Onye nhazi",
  "ask.alerts": "Ọkwa",
  "ask.coverageGaps": "Oghere mkpuchi",
  "ask.wardCoverage": "Mkpuchi ward",
  "readiness.claimsHeading": "Nkwuputa njikere (CANON)",
  "welcome.heading": "Nnabata",

  // ---- Pass 2 additions ----
  "a11y.closeAsk": "Mechie Jụọ ElectionCanon",
  "ask.activityTrend": "Ụzọ omume",
  "home.noActiveResponsibility": "Enweghị ọrụ nlekọta ugbu a",
  "home.noActivityYet": "Enwebeghị omume nzukọ edekọrọ ruo ugbu a.",
  "home.operationalStatus": "Ọnọdụ ọrụ",
  "readiness.gapsHeading": "Oghere (sitere na CANON)",
  "readiness.knownWardCoverage": "Mkpuchi ward amaara",
  "readiness.notTrackedYet": "ElectionCanon asoghị nke a aka ruo ugbu a.",
  "territory.noPuImportedWard": "Enwebeghị polling unit ebubatara ruo ugbu a maka ward a.",
  "territory.setYours": "Hazie ebe ntuli aka gị",
  "a11y.navDialog": "Ntụziaka bụ isi",
  "a11y.navMenuClose": "Mechie menu ntụziaka",
  "a11y.navMenuOpen": "Mepee menu ntụziaka",
  "a11y.primaryNav": "Isi",
  "action.addPerson": "Tinye mmadụ",
  "action.addVariant": "Tinye ụdị asụsụ",
  "action.approve": "Kwado",
  "action.attach": "Nyekọta",
  "action.changeAssignmentStatus": "Gbanwee ọnọdụ ọrụ enyere",
  "action.changeTaskStatus": "Gbanwee ọnọdụ ọrụ",
  "action.confirmHeading": "Kwenye",
  "action.createAssignment": "Mepụta ọrụ e nyere",
  "action.createTask": "Mepụta ọrụ",
  "action.openChat": "Mepee Nkwekọrịta",
  "action.openElectionDay": "Mepee Ọrụ Ntuli Aka",
  "action.openMobilize": "Mepee Ọrụ",
  "action.openReadiness": "Mepee Njikere",
  "action.openStudio": "Mepee Studio",
  "action.prepare": "Kwadebe",
  "action.preparing": "Na-akwadebe…",
  "action.recording": "Na-edekọ…",
  "action.reviewHeading": "Nyochaa",
  "action.saveBriefMasterText": "Chekwaa nchịkọta / isi ihe odide",
  "ask.answerHeading": "Azịza",
  "ask.askButton": "Jụọ",
  "ask.asking": "Na-ajụ…",
  "ask.electionDaySimStats": "Ọnụọgụgụ nnomi ụbọchị ntuli aka",
  "ask.groundedInCanon": "Sitere na ndekọ campaign gị n'onwe ya.",
  "ask.inputPlaceholder": "Jụọ ElectionCanon…",
  "ask.languageFallbackBanner": "Azara ya n'Asụsụ Bekee — a ka na-enyocha asụsụ a site n'aka ndị na-asụ ya dị ka asụsụ obodo, o kakwaghị enwebeghị azịza Jụọ ElectionCanon nke aka ya.",
  "ask.nextActionHeading": "Ihe ị ga-eme ọzọ",
  "ask.noOpenAlerts": "Enweghị ọkwa dị oghe.",
  "ask.recordActionHeading": "Dekọọ omume campaign",
  "ask.recordActionPlaceholder": "dịka \"Nye Team 6 Ward 6\" ma ọ bụ \"Kọọ na Ward 6 na-aga nke ọma\"",
  "ask.scopedQuestionGuidance": "Jụọ ajụjụ metụtara naanị data ElectionCanon nke campaign a. Naanị Bekee na Alpha a; a na-aghọta asụsụ ndị ọzọ ma na-aza ha n'Asụsụ Bekee, na-ekwupụta nke ahụ, ọ dịghị mgbe ọ bụla na-emepụta ntụgharị asụsụ ụgha.",
  "ask.seeCanon": "Lee Canon →",
  "ask.taskBottlenecks": "Ihe mgbochi ọrụ",
  "candidate.alreadySetOnTerritory": "Edobeworị ya na Ebe — a gaghị ajụ ya ọzọ ebe a.",
  "candidate.completeRegistration": "Mechaa ndebanye aha onye isi ntuli aka",
  "candidate.namePlaceholder": "Aha zuru ezu nke onye isi ntuli aka",
  "candidate.party": "Pati",
  "canon.filterByCategory": "Nhazi site n'ụdị",
  "canon.recordLabel": "Ndekọ:",
  "canon.statusLabel": "Ọnọdụ:",
  "canon.whenLabel": "Oge:",
  "canon.whereLabel": "Ebe:",
  "chat.message": "Ozi",
  "chat.messagePlaceholder": "Dee ozi…",
  "chat.newRoomName": "Aha ụlọ ọhụrụ",
  "chat.newRoomPlaceholder": "dịka Nkwekọrịta Ward 3",
  "chat.noMessagesYet": "Enweghị ozi ugbu a — kelee.",
  "chat.referenceId": "ID ntụaka",
  "chat.referenceIdPlaceholder": "ID ya",
  "chat.referenceType": "Ụdị ntụaka",
  "chat.roomType": "Ụdị ụlọ",
  "comms.addLanguageVariant": "Tinye ụdị asụsụ",
  "comms.attachAsset": "Nyekọta ihe Studio",
  "comms.brief": "Nchịkọta",
  "comms.briefGuidance": "Ozi n'ime maka nzikọrịta ozi a. A naghị enyocha ma ọ bụ kwado ya n'onwe ya.",
  "comms.chooseCommGuidance": "Họrọ nzikọrịta ozi ka ị hụ ihe ndị jikọtara ya na ụdị asụsụ ya.",
  "comms.detailHeading": "Nkọwa",
  "comms.masterText": "Isi ihe odide",
  "comms.newTitlePlaceholder": "Isiokwu nzikọrịta ozi ọhụrụ",
  "comms.noAssetsAttached": "Enwebeghị ihe Studio enyekọtara.",
  "comms.noCommsYet": "Enwebeghị nzikọrịta ozi ugbu a — mepụta otu ka ị malite ịhazi.",
  "comms.reviewNotes": "Ndetu (achọrọ ya ma ọ bụrụ na ị na-ajụ)",
  "comms.revocationReason": "Ihe kpatara mkagbu…",
  "comms.revocationReasonLabel": "Ihe kpatara mkagbu",
  "comms.variantText": "Ihe odide ụdị asụsụ",
  "comms.yourReview": "Nyocha gị",
  "electionDay.coverageHeading": "Mkpuchi — steeti / LGA / ward / polling unit",
  "electionDay.simDisclosure": "Data nnomi / ngosi — ọ bụghị nsonaazụ ntuli aka gọọmentị",
  "electionDay.simPhotoDisclosure": "Ọ bụ ihe nnomi — foto gbara n'ezie ka e bugoro, mana ọ bụghị nsonaazụ gọọmentị",
  "electionDay.simResultsDisclosure": "Data ntuli aka nnomi — ọ bụghị nsonaazụ gọọmentị",
  "home.coverageLgasWards": "Mkpuchi — LGA na ward",
  "home.electionDayLabel": "Ụbọchị Ntuli Aka",
  "home.mobilizationLabel": "Mobilization",
  "home.studioLabel": "Campaign Studio",
  "home.whatToDoNext": "Ihe ị ga-eme ugbu a",
  "mobilize.agentCoverage": "Mkpuchi ndị nnọchite dabere na mpaghara",
  "mobilize.noAssignmentsYet": "Enwebeghị ọrụ e nyere edekọrọ.",
  "mobilize.noPeopleYet": "Enwebeghị mmadụ e tinyere.",
  "mobilize.noTasksYet": "Enwebeghị ọrụ e mepụtara.",
  "nav.drawerHeading": "Ntụziaka",
  "org.email": "Email",
  "org.emailPlaceholder": "dịka john@example.com",
  "org.invitationCreated": "E mepụtala ọkpụkpọ",
  "org.languageCapabilities": "Ikike Asụsụ",
  "org.name": "Aha",
  "org.namePlaceholder": "dịka John Doe",
  "org.needTerritoryFirst": "Debe ebe gị na taabụ Ebe tupu ị kpọọ mmadụ.",
  "org.noLanguageCapability": "Enwebeghị ikike asụsụ ekwupụtara.",
  "org.noMembers": "Enweghị onye otu ịgosi.",
  "org.territoryPrefix": "Ebe:",
  "responsibility.newPerson": "Onye ọhụrụ na-elekọta",
  "responsibility.reasonPlaceholder": "dịka Kwagara ebe ọzọ, lara azụ, dabara nke ọma na ward a",
  "role.constituencyLead": "Constituency Lead",
  "role.director": "Campaign Director",
  "status.active": "NA-ARỤ ỌRỤ",
  "status.proposedNotRecorded": "Omume a tụrụ aro — edebeghị ya",
  "studio.aiInteractionLanguage": "Gwa AI okwu na",
  "studio.creativeCommandPlaceholder": "dịka \"tọọ isiokwu n'etiti\"",
  "studio.creativeOutputLanguage": "Ihe odide foto na",
  "studio.family": "Ụdị",
  "studio.interfaceLanguage": "Ihu",
  "studio.languageHeading": "Asụsụ",
  "studio.noAiImageDisclosure": "Naanị ihe odide/agba — enweghị njikọ AI maka imepụta foto",
  "studio.noPhotoAdded": "Enwebeghị foto e tinyere",
  "studio.opacity": "Opacity",
  "territory.electionPlaceholder": "dịka Ntuli Aka Mba 2027",
  "territory.lgaCoordinatorsHeading": "Ndị Nchịkọta LGA",
  "territory.national": "Mba",
  "territory.noLgasWardsYet": "Enwebeghị LGA ma ọ bụ ward amaara maka ebe campaign a ugbu a.",
  "territory.noWardsImported": "Enwebeghị ward ebubatara maka LGA a ugbu a.",
  "territory.selectLgaFirst": "Họrọ LGA mbụ.",
  "territory.selectWardFirst": "Họrọ ward mbụ.",
  "territory.ward": "Ward",
  "territory.wardCoordinatorsHeading": "Ndị Nchịkọta Ward",
  "territory.yourAssigned": "Ebe e nyere gị",
  "voice.comingSoon": "Olu · na-abịa n'oge na-adịghị anya",
  "welcome.availableNow": "Ihe dị ugbu a",
  "welcome.comingNext": "Ihe na-abịa n'ihu",
  "welcome.setUpWorkspace": "Hazie ebe ọrụ ntuli aka gị",
  "home.nextActionCandidateRegistered": "Mechaa ndebanye aha onye isi ntuli aka.",
  "home.nextActionWardAssignment": "Kwadebe ward mbụ gị.",
  "home.nextActionWardStatusHealth": "Kọọ ọnọdụ ward ugbu a.",
  "home.nextActionObserverAssignment": "Kenye onye nlekọta mbụ gị ọrụ.",
  "home.nextActionReviewGaps": "Nyochaa oghere njikere gị.",

  // ---- VISIBILITY EXPANSION PASS (landing + home) ----
  "landing.heroHeadline": "Usoro arụmọrụ maka ịgba mbọ kampeeni ntuli aka.",
  "landing.heroSubheadline": "Site n'ọchịchị isi kampeeni ruo ebe ịtụ vootu, onye ọ bụla maara ihe ọ bụ ibu ọrụ ya, ebe ọ bụ ibu ọrụ ya, na ihe ka fọdụrụ ime.",
  "landing.heroBody": "ElectionCanon na-anọchi anya nhazi kampeeni gbasasịrị — mkparịta ụka, oku, na spreadsheet gbasasịrị — site n'otu usoro arụmọrụ a pụrụ ịtụkwasị obi: mpaghara, nhazi, ibu ọrụ, njikere, na nkwekọrịta, nke niile e wuru n'elu otu ndekọ omume nke ihuenyo ọ bụla na-agụpụta.",
  "landing.ctaStart": "Malite Kampeeni →",
  "landing.ctaHowItWorks": "Hụ Otú Ọ Si Arụ Ọrụ →",
  "landing.problemKicker": "Nsogbu Ahụ",
  "landing.problemHeading": "Ihazi ọrụ kampeeni na-abụkarị ihe gbasasịrị n'ebe iri na abụọ dị iche iche.",
  "landing.problemBody": "Nke a apụghị ịgbaghara na kampeeni anaghị arụsi ọrụ ike — ọ na-egosi na ọrụ ahụ enweghị ebe ha niile ga-anọkọ. ElectionCanon bụ ihe owuwu na-ejikọta ha niile: otu ndekọ nke onye ọ bụla n'ime kampeeni nwere ike ịtụkwasị obi, kama iri na abụọ gbasasịrị nke ọ dịghị onye hụrụ ha niile.",
  "landing.problemTag.whatsapp": "Otu WhatsApp",
  "landing.problemTag.calls": "Oku ekwentị",
  "landing.problemTag.spreadsheets": "Spreadsheets",
  "landing.problemTag.volunteers": "Ndị ọrụ afọ ofufo gbasasịrị",
  "landing.problemTag.responsibility": "Ibu ọrụ na-edoghị anya",
  "landing.problemTag.territory": "Mkpuchi mpaghara a na-amaghị ama",
  "landing.problemTag.mobilisation": "Ịkpọkọta ndị mmadụ n'oge ikpeazụ",
  "landing.canonKicker": "Canon Ahụ",
  "landing.canonHeading": "Omume ọ bụla na-ahapụ ndekọ.",
  "landing.canonBody": "ElectionCanon na-akpọ ndekọ a Canon — otu akụkọ ihe mere eme, nke e kewapụrụ iche nye kampeeni ọ bụla, bụ nke ihuenyo ọ bụla na-agụpụta ma omume ọ bụla na-edetu. Kenye ward ọrụ. Kọwaa ọkwa njikere. Ziga ozi. Nke ọ bụla na-aghọ eziokwu na-adịgide adịgide, nke a kọwapụtara onye kpatara ya, ọ bụghị nkwupụta na-apụ n'ekwentị onye ọzọ na nkịtị.",
  "landing.chainAction": "Omume",
  "landing.chainEvent": "Ihe Omume",
  "landing.chainRecord": "Ndekọ",
  "landing.howItWorksKicker": "Otú ElectionCanon Si Arụ Ọrụ",
  "landing.howItWorksHeading": "Site na ntuli aka ruo ụbọchị ntuli aka, n'otu usoro na-aga n'ihu.",
  "landing.step.election": "Ntuli aka",
  "landing.step.territory": "Mpaghara",
  "landing.step.organisation": "Nhazi",
  "landing.step.responsibility": "Ibu ọrụ",
  "landing.step.electionDay": "Ụbọchị Ntuli Aka",
  "landing.hierarchyKicker": "Site n'Ọchịchị Isi Kampeeni Ruo Ebe Ịtụ Vootu",
  "landing.hierarchyHeading": "Onye ọ bụla na-enweta ezigbo ibu ọrụ arụmọrụ — ọ bụghị naanị aha ọzọ na mkparịta ụka otu.",
  "landing.hierarchy.command": "Ọchịchị Isi Kampeeni",
  "landing.workspaceKicker": "Studio Kampeeni",
  "landing.workspaceHeading": "Ihe niile kampeeni chọrọ, n'otu ebe ọrụ.",
  "landing.differenceKicker": "Ihe Dị Iche",
  "landing.differenceHeading": "ElectionCanon na-ejikọta ihe ndị na-anọkarị na-ejikọghị ọnụ.",
  "landing.existsKicker": "Ihe Dị Ugbu A",
  "landing.existsHeading": "Na-arụ ọrụ, nnomi, na n'ịmepe — ọ dịghị mgbe a gwakọtara ha ọnụ.",
  "landing.categoryOperational": "Na-Arụ Ọrụ",
  "landing.categoryInDevelopment": "N'ịmepe",
  "landing.architectureKicker": "Nhazi Owuwu",
  "landing.architectureHeading": "Ọnụ ụlọ na-agụ. Ihe omume na-ede.",
  "landing.openSourceKicker": "Mmepe Gbasara Onwe",
  "landing.openSourceHeading": "Nyochaa igwe ahụ.",
  "landing.openSourceBody1": "E nyere ElectionCanon ikike n'okpuru AGPL-3.0 — gụọ ya, mee ka ọ rụọ ọrụ n'ebe ị nọ, jụọ ya ajụjụ, wee melite ya. Ngwá ọrụ ntuli aka kwesịrị ịbụ ihe ndị mmadụ na-adabere na ya nwere ike inyocha, ọ bụghị igbe ojii a na-apụghị ịmata ihe dị n'ime ya.",
  "landing.openSourceBody2": "Soro anyị wuo ya. Ebe nchekwa ọha na eze nke onwe ya, nke ElectionCanon na-achịkwa, adịla ugbu a. Gụọ ya, mee ka ọ rụọ ọrụ n'ebe ị nọ, jụọ ya ajụjụ, wee tinye aka ka ọrụ ahụ na-aga n'ihu.",
  "landing.whoKicker": "Ndị Nke A Bụ Maka Ha",
  "landing.audience.candidate": "Kampeeni ndị na-asọ mpi",
  "landing.audience.directors": "Ndị nduzi kampeeni",
  "landing.audience.coordinators": "Ndị nhazi ọrụ ubi",
  "landing.audience.volunteers": "Ndị ọrụ afọ ofufo",
  "landing.audience.observers": "Ndị nnọchi anya nlekọta / nyocha",
  "landing.audience.opsTeams": "Ndị otu ọrụ ntuli aka",
  "landing.nonAffiliation": "ElectionCanon anaghị akwadoro ma ọ bụ megide ndị otu ọ bụla ma ọ bụ onye ọsọ mpi, ojiji ya enweghịkwa ọnụ ọgụgụ nkwado site n'aka, ma ọ bụ mmekọrịta na, ụlọ ọrụ ntuli aka ọ bụla ma ọ bụ ụlọ ọrụ gọọmentị ọ bụla.",
  "landing.startKicker": "Malite",
  "landing.startHeading": "Mepụta kampeeni ElectionCanon gị.",
  "landing.startBody": "Mepụta akaụntụ, hiwe kampeeni gị, họrọ ntuli aka gị, ọkwa gị, na mpaghara ntuli aka gị, wee malite iwu nhazi gị — site n'ọchịchị isi kampeeni ruo ebe ịtụ vootu.",
  "landing.footerCopyright": "ElectionCanon — mmepe gbasara onwe n'okpuru AGPL-3.0.",
  "landing.viewSourceCta": "Lee koodu na GitHub →",
  "home.continuePreparation": "Gaa n'ihu na Njikere →",
  "home.allClear": "IHE NIILE DỊ MMA — ọ nweghị ihe chọrọ nlebara anya ugbu a.",
  "home.toneUrgent": "Ngwa Ngwa",
  "home.toneWatch": "Lelee",
  "action.inviteSomeone": "Kpọọ onye ọzọ",
  "home.viewAllEventsCanon": "Lee ihe omume niile — Canon →",
  "home.noActiveResponsibilityBody1": "Ahụghị ibu ọrụ na-arụ ọrụ maka akaụntụ a.",
  "home.noActiveResponsibilityBody2": "Kpọtụrụ onye nwe kampeeni gị ma ọ bụrụ na ị chere na nke a bụ mperi — ha nwere ike ikenye ma ọ bụ gbanwee ibu ọrụ site na Ndị mmadụ ma ọ bụ Ebe.",
  "home.observerOrgLabel": "Nzukọ nnọchi anya / nlekọta",
  "home.candidateCampaignLabel": "Kampeeni onye ọsọ mpi",
  "home.readinessAllComplete": "Akụkụ njikere ọ bụla a na-eso efu ka EMECHAALA. Lelee Ụbọchị Ntuli Aka maka nzọụkwụ ọzọ.",
});

const yo = Object.freeze({
  "nav.home": "Àkótán",
  "nav.organisation": "Àwọn Ènìyàn",
  "nav.territory": "Àwọn Ibi",
  "nav.mobilize": "Iṣẹ́",
  "nav.electionDay": "Àwọn Iṣẹ́ Ìdìbò",
  "nav.chat": "Ìṣọ̀kan",
  "nav.studio": "Studio",
  "nav.intelligence": "Béèrè lọ́wọ́ ElectionCanon",
  "nav.canon": "Canon",
  "nav.readiness": "Ìmúrasílẹ̀",
  "nav.settings": "Ètò",
  "action.signOut": "Jáde",
  "action.cancel": "Fagilé",
  "action.done": "Ti parí",
  "action.back": "Padà",
  "action.create": "Dá",
  "action.send": "Fi ránṣẹ́",
  "action.revoke": "Fagilé àṣẹ",
  "action.assign": "Yàn",
  "common.reason": "Ìdí",
  "home.yourScope": "Ààlà iṣẹ́ yín",
  "home.yourElection": "Ìdìbò yín",
  "home.whatNeedsAttention": "Ohun tí ó nílò àfiyèsí lónìí",
  "home.whatChanged": "Ohun tí ó yí padà",
  "home.yourWards": "Ward yín",
  "home.yourPollingUnits": "Polling unit yín",
  "coverage.heading": "Ìbora",
  "role.lgaCoordinator": "LGA Coordinator",
  "role.wardCoordinator": "Ward Coordinator",
  "role.puAgent": "Polling-Unit Agent",
  "org.whosInvolved": "Àwọn tí ó kópa",
  "org.noTeamYet": "Kò sí ẹgbẹ́ kan síbẹ̀.",
  "org.invitationsHeading": "Ìwé ìpè",
  "territory.office": "Ipò",
  "territory.state": "Ìpínlẹ̀",
  "territory.constituency": "Agbègbè ìbò",
  "territory.lgas": "Ìjọba Ìbílẹ̀",
  "mobilize.fieldRoster": "Àtòjọ oṣiṣẹ́",
  "mobilize.assignments": "Iṣẹ́ tí a yàn",
  "mobilize.tasks": "Àwọn iṣẹ́",
  "electionDay.puAgentsHeading": "Aṣojú polling unit",
  "electionDay.resultsHeading": "Àbájade (àfarawé)",
  "electionDay.captureResult": "Kó àbájade",
  "electionDay.incidentLog": "Àkọsílẹ̀ ìṣẹ̀lẹ̀",
  "chat.coordinationRooms": "Yàrá ìṣọ̀kan",
  "chat.roomsHeading": "Àwọn yàrá",
  "chat.conversationHeading": "Ìjíròrò",
  "chat.communications": "Ìbánisọ̀rọ̀",
  "studio.templatesHeading": "Àwòṣe",
  "studio.yourAssets": "Ohun ìní yín",
  "studio.editorHeading": "Aṣàtúnṣe",
  "ask.alerts": "Ìkìlọ̀",
  "ask.coverageGaps": "Àlàfo ìbora",
  "ask.wardCoverage": "Ìbora ward",
  "readiness.claimsHeading": "Ẹ̀rí ìmúrasílẹ̀ (CANON)",
  "welcome.heading": "Káàbọ̀",

  // ---- Pass 2 additions ----
  "a11y.closeAsk": "Ti Béèrè lọ́wọ́ ElectionCanon",
  "ask.activityTrend": "Ìgbà ìgbòkègbodò",
  "home.noActiveResponsibility": "Kò sí iṣẹ́ àbójútó kan lọ́wọ́lọ́wọ́",
  "home.noActivityYet": "Kò sí iṣẹ́ àjọ tí a kọ sílẹ̀ síbẹ̀.",
  "home.operationalStatus": "Ìpò iṣẹ́",
  "readiness.gapsHeading": "Àlàfo (láti CANON)",
  "readiness.knownWardCoverage": "Ìbora ward tí a mọ̀",
  "readiness.notTrackedYet": "ElectionCanon kò tí ì tẹ̀lé èyí síbẹ̀.",
  "territory.noPuImportedWard": "Kò sí polling unit tí a kó wọlé síbẹ̀ fún ward yìí.",
  "territory.setYours": "Tò àgbègbè ìdìbò yín sílẹ̀",
  "a11y.navDialog": "Atọ́nà pàtàkì",
  "a11y.navMenuClose": "Ti àtòjọ atọ́nà",
  "a11y.navMenuOpen": "Ṣí àtòjọ atọ́nà",
  "a11y.primaryNav": "Pàtàkì",
  "action.addPerson": "Fi ènìyàn kún",
  "action.addVariant": "Fi ẹ̀yà èdè kún",
  "action.approve": "Fọwọ́sí",
  "action.attach": "So mọ́",
  "action.changeAssignmentStatus": "Yí ìpò iṣẹ́ tí a yàn padà",
  "action.changeTaskStatus": "Yí ìpò iṣẹ́ padà",
  "action.confirmHeading": "Jẹ́rìí sí",
  "action.createAssignment": "Dá iṣẹ́ tí a yàn",
  "action.createTask": "Dá iṣẹ́",
  "action.openChat": "Ṣí Ìṣọ̀kan",
  "action.openElectionDay": "Ṣí Àwọn Iṣẹ́ Ìdìbò",
  "action.openMobilize": "Ṣí Iṣẹ́",
  "action.openReadiness": "Ṣí Ìmúrasílẹ̀",
  "action.openStudio": "Ṣí Studio",
  "action.prepare": "Múrasílẹ̀",
  "action.preparing": "Ń múrasílẹ̀…",
  "action.recording": "Ń kọ sílẹ̀…",
  "action.reviewHeading": "Ṣàtúnyẹ̀wò",
  "action.saveBriefMasterText": "Fi àkótán / ẹ̀dà àkọ́kọ́ pamọ́",
  "ask.answerHeading": "Ìdáhùn",
  "ask.askButton": "Béèrè",
  "ask.asking": "Ń béèrè…",
  "ask.electionDaySimStats": "Ìkà-àfarawé ọjọ́ ìdìbò",
  "ask.groundedInCanon": "Ó dá lórí àkọsílẹ̀ campaign yín fúnra rẹ̀.",
  "ask.inputPlaceholder": "Béèrè lọ́wọ́ ElectionCanon…",
  "ask.languageFallbackBanner": "A dáhùn ní Èdè Gẹ̀ẹ́sì — èdè yìí ń tẹ̀síwájú láti ṣe àyẹ̀wò láti ọwọ́ àwọn ọ̀mọ̀wé onísọ̀rọ̀-ìbílẹ̀, kò sì tí ì ní àwọn ìdáhùn Béèrè lọ́wọ́ ElectionCanon tirẹ̀ síbẹ̀.",
  "ask.nextActionHeading": "Ìgbésẹ̀ tókàn",
  "ask.noOpenAlerts": "Kò sí ìkìlọ̀ tí ó ṣí sílẹ̀.",
  "ask.recordActionHeading": "Kọ ìgbésẹ̀ campaign sílẹ̀",
  "ask.recordActionPlaceholder": "bí i \"Yan Team 6 sí Ward 6\" tàbí \"Sọ pé Ward 6 ń lọ dáradára\"",
  "ask.scopedQuestionGuidance": "Béèrè ìbéèrè tí ó ní í ṣe pẹ̀lú dátà ElectionCanon campaign yìí nìkan. Èdè Gẹ̀ẹ́sì nìkan ní Alpha yìí; a mọ àwọn èdè yòókù, a sì ń dáhùn wọn ní Èdè Gẹ̀ẹ́sì pẹ̀lú àkíyèsí náà, a kì í dá ìtúmọ̀ èké sílẹ̀.",
  "ask.seeCanon": "Wo Canon →",
  "ask.taskBottlenecks": "Ìdíwọ́ iṣẹ́",
  "candidate.alreadySetOnTerritory": "A ti tò ó sílẹ̀ nínú Àwọn Ibi tẹ́lẹ̀ — a kò ní í tún béèrè níhìn-ín.",
  "candidate.completeRegistration": "Parí ìforúkọsílẹ̀ olùdíje",
  "candidate.namePlaceholder": "Orúkọ kíkún olùdíje",
  "candidate.party": "Ẹgbẹ́ olóṣèlú",
  "canon.filterByCategory": "Ṣàyẹ̀wò nípa ẹ̀ka",
  "canon.recordLabel": "Àkọsílẹ̀:",
  "canon.statusLabel": "Ìpò:",
  "canon.whenLabel": "Nígbà tí:",
  "canon.whereLabel": "Níbi tí:",
  "chat.message": "Ìránṣẹ́",
  "chat.messagePlaceholder": "Kọ ìránṣẹ́…",
  "chat.newRoomName": "Orúkọ yàrá tuntun",
  "chat.newRoomPlaceholder": "bí i Ìṣọ̀kan Ward 3",
  "chat.noMessagesYet": "Kò sí ìránṣẹ́ kan síbẹ̀ — ẹ kí wọn.",
  "chat.referenceId": "ID ìtọ́kasí",
  "chat.referenceIdPlaceholder": "ID rẹ̀",
  "chat.referenceType": "Irú ìtọ́kasí",
  "chat.roomType": "Irú yàrá",
  "comms.addLanguageVariant": "Fi ẹ̀yà èdè kún",
  "comms.attachAsset": "So ohun Studio mọ́",
  "comms.brief": "Àkótán",
  "comms.briefGuidance": "Àlàyé inú fún ìbánisọ̀rọ̀ yìí. A kì í ṣàyẹ̀wò tàbí fọwọ́sí i fúnra rẹ̀.",
  "comms.chooseCommGuidance": "Yan ìbánisọ̀rọ̀ kan láti rí àwọn ohun àti ẹ̀yà èdè tí ó so mọ́ ọn.",
  "comms.detailHeading": "Kúnrẹ́rẹ́",
  "comms.masterText": "Ẹ̀dà àkọ́kọ́",
  "comms.newTitlePlaceholder": "Orí-ọ̀rọ̀ ìbánisọ̀rọ̀ tuntun",
  "comms.noAssetsAttached": "Kò sí ohun Studio tí a so mọ́ síbẹ̀.",
  "comms.noCommsYet": "Kò sí ìbánisọ̀rọ̀ síbẹ̀ — dá ọ̀kan láti bẹ̀rẹ̀ ìgbèrò.",
  "comms.reviewNotes": "Àkíyèsí (pàtàkì bí a bá kọ̀)",
  "comms.revocationReason": "Ìdí fún ìfagilé…",
  "comms.revocationReasonLabel": "Ìdí ìfagilé",
  "comms.variantText": "Ọ̀rọ̀ ẹ̀yà èdè",
  "comms.yourReview": "Àyẹ̀wò yín",
  "electionDay.coverageHeading": "Ìbora — ìpínlẹ̀ / LGA / ward / polling unit",
  "electionDay.simDisclosure": "Dátà àfarawé / ìfihàn — kì í ṣe àbájade ìdìbò ìjọba",
  "electionDay.simPhotoDisclosure": "Ohun àfarawé ní — fọ́tò gidi tí a gbé sókè, àmọ́ kì í ṣe àbájade ìjọba",
  "electionDay.simResultsDisclosure": "Dátà ìdìbò àfarawé — kì í ṣe àbájade ìjọba",
  "home.coverageLgasWards": "Ìbora — LGA àti ward",
  "home.electionDayLabel": "Ọjọ́ Ìdìbò",
  "home.mobilizationLabel": "Mobilization",
  "home.studioLabel": "Campaign Studio",
  "home.whatToDoNext": "Ohun tí ẹ ó ṣe tókàn",
  "mobilize.agentCoverage": "Ìbora aṣojú nípa agbègbè",
  "mobilize.noAssignmentsYet": "Kò sí iṣẹ́ tí a yàn tí a kọ sílẹ̀ síbẹ̀.",
  "mobilize.noPeopleYet": "Kò sí ènìyàn tí a fi kún síbẹ̀.",
  "mobilize.noTasksYet": "Kò sí iṣẹ́ tí a dá síbẹ̀.",
  "nav.drawerHeading": "Atọ́nà",
  "org.email": "Ímeèlì",
  "org.emailPlaceholder": "bí i john@example.com",
  "org.invitationCreated": "A ti dá ìwé ìpè",
  "org.languageCapabilities": "Agbára Èdè",
  "org.name": "Orúkọ",
  "org.namePlaceholder": "bí i John Doe",
  "org.needTerritoryFirst": "Tò àgbègbè yín sílẹ̀ nínú táábù Àwọn Ibi kí ẹ tó pe ènìyàn.",
  "org.noLanguageCapability": "Kò sí agbára èdè tí a kéde síbẹ̀.",
  "org.noMembers": "Kò sí ọmọ ẹgbẹ́ láti fihàn.",
  "org.territoryPrefix": "Àgbègbè:",
  "responsibility.newPerson": "Ẹni tuntun tí yóò rí sí",
  "responsibility.reasonPlaceholder": "bí i Ó kúrò lọ sí ibòmíràn, ó fà sẹ́yìn, ó bá ward yìí mu jùlọ",
  "role.constituencyLead": "Constituency Lead",
  "role.director": "Campaign Director",
  "status.active": "Ń ṢISẸ́",
  "status.proposedNotRecorded": "Ìgbésẹ̀ tí a dábàá — a kò tí ì kọ ọ́ sílẹ̀",
  "studio.aiInteractionLanguage": "Bá AI sọ̀rọ̀ ní",
  "studio.creativeCommandPlaceholder": "bí i \"mú orí ọ̀rọ̀ sí àárín\"",
  "studio.creativeOutputLanguage": "Ọ̀rọ̀ àwòrán ní",
  "studio.family": "Ẹ̀ka",
  "studio.interfaceLanguage": "Ojú-ìsẹ́",
  "studio.languageHeading": "Èdè",
  "studio.noAiImageDisclosure": "Ọ̀rọ̀/àwọ̀ nìkan — kò sí ìsopọ̀ AI fún dídá àwòrán",
  "studio.noPhotoAdded": "Kò sí fọ́tò tí a fi kún",
  "studio.opacity": "Opacity",
  "territory.electionPlaceholder": "bí i Ìdìbò Àpapọ̀ 2027",
  "territory.lgaCoordinatorsHeading": "Àwọn Alábòójútó LGA",
  "territory.national": "Orílẹ̀-èdè",
  "territory.noLgasWardsYet": "Kò sí LGA tàbí ward tí a mọ̀ fún àgbègbè campaign yìí síbẹ̀.",
  "territory.noWardsImported": "Kò sí ward tí a kó wọlé síbẹ̀ fún LGA yìí.",
  "territory.selectLgaFirst": "Yan LGA kan ná.",
  "territory.selectWardFirst": "Yan ward kan ná.",
  "territory.ward": "Ward",
  "territory.wardCoordinatorsHeading": "Àwọn Alábòójútó Ward",
  "territory.yourAssigned": "Àgbègbè tí a yàn fún yín",
  "voice.comingSoon": "Ohùn · ń bọ̀",
  "welcome.availableNow": "Ohun tí ó wà báyìí",
  "welcome.comingNext": "Ohun tí ń bọ̀ nísinsin yìí",
  "welcome.setUpWorkspace": "Tò ibi iṣẹ́ ìdìbò yín sílẹ̀",
  "home.nextActionCandidateRegistered": "Parí ìforúkọsílẹ̀ olùdíje.",
  "home.nextActionWardAssignment": "Múrasílẹ̀ ward àkọ́kọ́ yín.",
  "home.nextActionWardStatusHealth": "Fi ìròyìn ipò ward kan sílẹ̀.",
  "home.nextActionObserverAssignment": "Yan aṣàkíyèsí àkọ́kọ́ yín.",
  "home.nextActionReviewGaps": "Ṣàyẹ̀wò àlàfo ìmúrasílẹ̀ yín.",

  // ---- VISIBILITY EXPANSION PASS (landing + home) ----
  "landing.heroHeadline": "Ètò tí ń darí ìpolongo ìdìbò.",
  "landing.heroSubheadline": "Láti àṣẹ àgbà ìpolongo títí dé ibùdó ìdìbò, olúkúlùkù mọ ohun tí ó jẹ́ ojúṣe rẹ̀, ibi tí ó jẹ́ ojúṣe rẹ̀, àti ohun tí ó ṣì kù láti ṣe.",
  "landing.heroBody": "ElectionCanon rọ́pò ìṣọ̀kan ìpolongo tí ó tàn ká — ìjíròrò, ìpè, àti spreadsheet tí ó tàn ká — pẹ̀lú ètò kan tí a lè ṣírò fún: agbègbè, àjọ, ojúṣe, ìmúrasílẹ̀, àti ìṣọ̀kan, gbogbo rẹ̀ ni a kọ́ sórí àkọsílẹ̀ kan ṣoṣo tí ojú ìwé kọ̀ọ̀kan ti ń kà.",
  "landing.ctaStart": "Bẹ̀rẹ̀ Ìpolongo →",
  "landing.ctaHowItWorks": "Wo Bí Ó Ṣe Ń Ṣiṣẹ́ →",
  "landing.problemKicker": "Ìṣòro Náà",
  "landing.problemHeading": "Ìṣọ̀kan iṣẹ́ ìpolongo máa ń tàn ká ibi tó lé ní méjìlá tó yàtọ̀ síra.",
  "landing.problemBody": "Èyí kò túmọ̀ sí pé ìpolongo náà kò ń ṣiṣẹ́ kára — ó túmọ̀ sí pé iṣẹ́ náà kò ní ibì kan tí gbogbo ènìyàn ti lè rí i papọ̀. ElectionCanon ni ìlànà tó so gbogbo rẹ̀ pọ̀: àkọsílẹ̀ kan ṣoṣo tí olúkúlùkù nínú ìpolongo lè gbẹ́kẹ̀lé, dípò ọ̀pọ̀lọpọ̀ tó tàn ká tí kò sí ẹni tó rí gbogbo rẹ̀.",
  "landing.problemTag.whatsapp": "Àwùjọ WhatsApp",
  "landing.problemTag.calls": "Pípe fóònù",
  "landing.problemTag.spreadsheets": "Spreadsheets",
  "landing.problemTag.volunteers": "Àwọn yọ̀ọ̀dá tí ó tàn ká",
  "landing.problemTag.responsibility": "Ojúṣe tí kò ṣe kedere",
  "landing.problemTag.territory": "Bí agbègbè ṣe bò tí a kò mọ̀",
  "landing.problemTag.mobilisation": "Ìkójọ ní ìṣẹ́jú ìkẹyìn",
  "landing.canonKicker": "Canon Náà",
  "landing.canonHeading": "Gbogbo ìgbésẹ̀ ló máa ń fi àkọsílẹ̀ sílẹ̀.",
  "landing.canonBody": "ElectionCanon ń pe àkọsílẹ̀ yìí ní Canon — ìtàn kan ṣoṣo, tí a ya sọ́tọ̀ fún ipolongo kọ̀ọ̀kan, tí ojú ìwé kọ̀ọ̀kan ti ń kà àti tí ìgbésẹ̀ kọ̀ọ̀kan ti ń kọ sí. Yan ẹnìkan fún ward. Fi ìròyìn ìmúrasílẹ̀ ránṣẹ́. Fi ìsọfúnni ránṣẹ́. Olúkúlùkù yóò di òtítọ́ tí ó dúró sójú kan, tí a mọ ẹni tí ó kọ ọ́, kì í ṣe ọ̀rọ̀ tí ó máa ń pòórá sínú fóònù ẹnìkan láìpẹ́.",
  "landing.chainAction": "Ìgbésẹ̀",
  "landing.chainEvent": "Ìṣẹ̀lẹ̀",
  "landing.chainRecord": "Àkọsílẹ̀",
  "landing.howItWorksKicker": "Bí ElectionCanon Ṣe Ń Ṣiṣẹ́",
  "landing.howItWorksHeading": "Láti ìdìbò títí dé ọjọ́ ìdìbò, nínú ètò kan ṣoṣo tí kò dáwọ́ dúró.",
  "landing.step.election": "Ìdìbò",
  "landing.step.territory": "Agbègbè",
  "landing.step.organisation": "Àjọ",
  "landing.step.responsibility": "Ojúṣe",
  "landing.step.electionDay": "Ọjọ́ Ìdìbò",
  "landing.hierarchyKicker": "Láti Àṣẹ Àgbà Ìpolongo Dé Ibùdó Ìdìbò",
  "landing.hierarchyHeading": "Olúkúlùkù ènìyàn ló ń gba ojúṣe iṣẹ́ gidi gan-an — kì í ṣe orúkọ mìíràn nìkan nínú ìjíròrò àwùjọ.",
  "landing.hierarchy.command": "Àṣẹ Àgbà Ìpolongo",
  "landing.workspaceKicker": "Studio Ìpolongo",
  "landing.workspaceHeading": "Ohun gbogbo tí ìpolongo nílò, nínú ibi iṣẹ́ kan ṣoṣo.",
  "landing.differenceKicker": "Ìyàtọ̀ Náà",
  "landing.differenceHeading": "ElectionCanon ń so àwọn nǹkan tí wọ́n sábà máa ń yà sọ́tọ̀ pọ̀.",
  "landing.existsKicker": "Ohun Tí Ó Wà Lónìí",
  "landing.existsHeading": "Tí ń ṣiṣẹ́, àfarawé, àti èyí tí ń dàgbà — a kò lè dàpọ̀ wọ́n rí.",
  "landing.categoryOperational": "Tí Ń Ṣiṣẹ́",
  "landing.categoryInDevelopment": "Ń Dàgbà",
  "landing.architectureKicker": "Ìgbékalẹ̀",
  "landing.architectureHeading": "Yàrá ń kà. Ìṣẹ̀lẹ̀ ń kọ.",
  "landing.openSourceKicker": "Orísun Ṣíṣí",
  "landing.openSourceHeading": "Yẹ ẹ̀rọ náà wò.",
  "landing.openSourceBody1": "ElectionCanon ní ìyọ̀ọ̀da lábẹ́ AGPL-3.0 — ka a, fi ṣiṣẹ́ ní ibi tìrẹ, bi í léèrè, kí o sì mú un dára sí i. Ohun èlò ìdìbò yẹ kí ó jẹ́ èyí tí àwọn ènìyàn tí wọ́n gbáralé e lè yẹ̀ wò, kì í ṣe àpótí dúdú tí a kò lè mọ ohun tí ń bẹ nínú rẹ̀.",
  "landing.openSourceBody2": "Jọ̀wọ́ bá wa kọ́ ọ. Ibi ìpamọ́ gbogbo ènìyàn tí ó dúró fúnra rẹ̀, tí ElectionCanon ń ṣàkóso, ti bẹ̀rẹ̀ sí í ṣiṣẹ́ nísinsìnyí. Ka a, fi ṣiṣẹ́ ní ibi tìrẹ, bi í léèrè, kí o sì fi ọwọ́ kan bí iṣẹ́ náà ṣe ń dàgbà.",
  "landing.whoKicker": "Àwọn Tí Èyí Jẹ́ Fún",
  "landing.audience.candidate": "Ìpolongo àwọn tó ń díje",
  "landing.audience.directors": "Olórí ìpolongo",
  "landing.audience.coordinators": "Olùṣàtúnṣe iṣẹ́ pápá",
  "landing.audience.volunteers": "Àwọn yọ̀ọ̀dá",
  "landing.audience.observers": "Àwọn àjọ aṣàkíyèsí / ìbojúwo",
  "landing.audience.opsTeams": "Àwọn ẹgbẹ́ iṣẹ́ ìdìbò",
  "landing.nonAffiliation": "ElectionCanon kò dúró fún tàbí lòdì sí ẹgbẹ́ òṣèlú tàbí olùdíje kankan, lílò rẹ̀ kò sì túmọ̀ sí ìtìlẹ́yìn láti ọ̀dọ̀, tàbí àjọṣe pẹ̀lú, àjọ olùdarí ìdìbò tàbí ilé-iṣẹ́ ìjọba kankan.",
  "landing.startKicker": "Bẹ̀rẹ̀",
  "landing.startHeading": "Dá ìpolongo ElectionCanon rẹ sílẹ̀.",
  "landing.startBody": "Dá àkáǹtì, dá ìpolongo rẹ sílẹ̀, yan ìdìbò rẹ, ipò rẹ, àti agbègbè ìbò rẹ, kí o sì bẹ̀rẹ̀ sí kọ́ àjọ rẹ — láti àṣẹ àgbà ìpolongo títí dé ibùdó ìdìbò.",
  "landing.footerCopyright": "ElectionCanon — orísun ṣíṣí lábẹ́ AGPL-3.0.",
  "landing.viewSourceCta": "Wo orísun lórí GitHub →",
  "home.continuePreparation": "Tẹ̀síwájú Ìmúrasílẹ̀ →",
  "home.allClear": "GBOGBO RẸ̀ DÁRA — kò sí ohun tí ó nílò àfiyèsí ní báyìí.",
  "home.toneUrgent": "Kánjú",
  "home.toneWatch": "Ṣọ́ra",
  "action.inviteSomeone": "Pe ẹnìkan",
  "home.viewAllEventsCanon": "Wo gbogbo ìṣẹ̀lẹ̀ — Canon →",
  "home.noActiveResponsibilityBody1": "A kò rí ojúṣe tí ń ṣiṣẹ́ lọ́wọ́ fún àkáǹtì yìí.",
  "home.noActiveResponsibilityBody2": "Kan sí ẹni tí ó ni ìpolongo rẹ bí o bá rò pé àṣìṣe ni èyí — wọ́n lè yan tàbí tún yan ojúṣe láti ara Àwọn Ènìyàn tàbí Àwọn Ibi.",
  "home.observerOrgLabel": "Àjọ aṣàkíyèsí / ìbojúwo",
  "home.candidateCampaignLabel": "Ìpolongo olùdíje",
  "home.readinessAllComplete": "Apá ìmúrasílẹ̀ kọ̀ọ̀kan tí a ń tọpinpin ti PÉ. Ṣayẹ̀wò Ọjọ́ Ìdìbò fún ìgbésẹ̀ tókàn.",
});

// ---------- URHOBO — PROPOSED COMMUNITY LOCALIZATION v0.1. Read this header
// before touching anything below — it records a correction made on intake.
//
// WHAT THIS IS. A product decision to ship a second, explicitly-labeled tier
// of Urhobo content alongside the single source-verified key this file
// previously had: UI-chrome strings drafted by an AI-assisted pass, supplied
// by the user for this exact purpose, reproduced here UNCHANGED (never
// "improved" or re-worded by this codebase's own tooling or a later model —
// see docs/multilingual/URHOBO-UI-PROPOSED-v0.1.md's own note on why). They
// are NOT native-certified, NOT reviewed by an Urhobo speaker, and NOT held
// to the same evidentiary bar as `studio.languageHeading` below. The
// selector's existing "(Review)" badge (languageCapability.js, unchanged)
// already communicates this honestly to a user, the same way it already does
// for Hausa/Igbo/Pidgin/Yoruba's own AI-drafted UI strings.
//
// INTAKE CORRECTION — READ BEFORE TRUSTING ANY "VERIFIED" LABEL ELSEWHERE.
// The source material this was drafted from labeled roughly half these keys
// "EXISTING_PROJECT_RESEARCH" or "SOURCE_VERIFIED", citing
// src/os/studio/urhobo/technical.js and lexicon.js by path. Checked against
// the ACTUAL content of those two files at intake: neither contains
// "election", "election day", "polling unit", "campaign", "operating
// system", "readiness", or "start" as an entry at all, and where an entry
// name does coincide (event/responsible/coordination in technical.js), that
// file's own `candidate` field is null — no Urhobo word was ever recorded
// for it. Those citations do not hold up. Every one of those labels has
// therefore been corrected to UNVERIFIED below (see URHOBO_PROPOSAL_STATUS),
// except the one key that genuinely does trace to this project's own cited
// Urhobo dictionary research (`studio.languageHeading`, unchanged from
// before). This is NOT a judgment that the drafted Urhobo wording itself is
// wrong — it may well be reasonable working Urhobo — only that the specific
// claim "this came from the project's own prior research" was false, and an
// honest product cannot repeat a false provenance claim just because the
// underlying guess might still be fine.
//
// NO_DEFENSIBLE_PROPOSAL keys from the source material are correctly ABSENT
// below (long architectural/legal/disclaimer prose, the non-affiliation
// boundary, AGPL licensing text) — English fallback, honestly, via the same
// INTENTIONAL_FALLBACKS sentinel every other undrafted Urhobo key already
// uses. Two further keys are deliberately absent even though the source
// material proposed a value: `home.operationalStatus` (the source material's
// own conclusion was "I would not invent this one... keeping the technical
// English term is safer") and `home.toneUrgent` (the source material's own
// conclusion was "I would not ship this particular term without Urhobo
// review") — both honored as written, not overridden.
//
// This is a ONE-TIME, EXPLICITLY-APPROVED, EXPLICITLY-LABELED exception for
// ordinary UI chrome only. It does NOT reverse this project's standing rule
// against inventing Urhobo elsewhere (lexicon.js, technical.js, phrases.js
// are all unchanged), does NOT touch the 27 Ask ElectionCanon response
// templates (urhobo/responses.js, still 0/27 approved), and does NOT touch
// any SAFETY_GATED_KEYS below — see that list's own section.
const urh = Object.freeze({
  // Ukere: "éphérẹ1 n. language" — SOURCE_VERIFIED, the highest confidence
  // tier urhobo/lexicon.js has. This is the one UI key this pass could
  // translate without inventing anything. Unchanged by the v0.1 pass below.
  "studio.languageHeading": "Éphérẹ",

  // ---- Landing / Hero ----
  "landing.heroHeadline": "Ekpoko ẹru-iruo re ọruẹ-iruo egbe-vwo ẹserovwo.",
  "landing.heroSubheadline": "Nẹ uvo-iruo egbe-vwo ruẹ asoya ẹserovwo, kohwo kohwo riẹ iruo-ẹso rọye, asẹ rọye, kẹ obo ro je kiẹko re a ru.",
  "landing.ctaStart": "Tonnọ Egbe-vwo →",
  "landing.ctaHowItWorks": "Mẹriẹ Obo Rọ Ruẹ Iruo Wan →",

  // ---- Landing / The Problem ----
  "landing.problemKicker": "Ukugbe-iweri",
  "landing.problemHeading": "Usuerin-eghwẹro egbe-vwo ghwariẹ shẹpḥẹ ni asa buebun.",
  "landing.problemTag.whatsapp": "Ukoko WhatsApp",
  "landing.problemTag.calls": "Isio-itẹlifoni",
  "landing.problemTag.spreadsheets": "Ibeba ẹchate",
  "landing.problemTag.volunteers": "Ihwo-evwovwe re ghwariẹ",
  "landing.problemTag.responsibility": "Iruo-ẹso ro phẹphẹ",
  "landing.problemTag.territory": "Asa-ẹserovwo rẹ a riẹ-ẹ",
  "landing.problemTag.mobilisation": "Egbe-egbe rẹ ukoko okiẹ",

  // ---- Landing / The Canon ---- ("Canon" itself stays "Canon" everywhere,
  // same as every other language — see nav.canon, deliberately not
  // redeclared here since it would be identical to the English fallback.)
  "landing.canonKicker": "Canon na",
  "landing.canonHeading": "Ekoko iruo eje ẹvwe ekere fiotọ.",
  "landing.chainAction": "Iruo",
  // chainEvent/chainRecord: UNVERIFIED — see header. The source material's
  // own first-pass draft recommended keeping "Event"/"Record" in English
  // "until Urhobo contributors have reviewed the concepts"; a later pass
  // overrode that under a citation that does not hold up (see header). Kept
  // here per this pass's "preserve, don't silently drop" instruction, but
  // flagged UNVERIFIED_INTERNALLY_DISPUTED in URHOBO_PROPOSAL_STATUS below —
  // treat as a priority community-review item, not a settled term.
  "landing.chainEvent": "Ẹfiamu",
  "landing.chainRecord": "Ekere",

  // ---- Landing / How It Works ----
  "landing.howItWorksKicker": "Obo rẹ ElectionCanon ruẹ iruo wan",
  "landing.howItWorksHeading": "Nẹ ẹserovwo ruẹ ẹdẹ ẹserovwo, vwẹ ẹvo ekpoko ẹru-iruo okiẹwo.",
  "landing.step.election": "Ẹserovwo",
  "territory.office": "Unue-iruo",
  "territory.constituency": "Asa-ẹphẹn ẹserovwo",
  "landing.step.territory": "Asa-ẹserovwo",
  "landing.step.organisation": "Ukoko-iruo",
  // step.responsibility / nav.readiness / step.electionDay: same dispute as
  // chainEvent/chainRecord above — source material's own first pass said
  // keep "Readiness"/"Responsibility"/"Election Day" in English; a later
  // pass overrode that under a disproven citation. Kept, flagged disputed.
  "landing.step.responsibility": "Iruo-ẹso",
  "nav.readiness": "Ẹmwana",
  "nav.chat": "Usuerin-eghwẹro",
  "landing.step.electionDay": "Ẹdẹ Ẹserovwo",

  // ---- Landing / Campaign Command to Polling Unit ----
  "landing.hierarchyKicker": "Nẹ Uvo-Iruo Egbe-vwo ruẹ Asoya Ẹserovwo",
  "landing.hierarchyHeading": "Kohwo kohwo vwe iruo-ẹso oru-iruo rọ gbare — ẹdia odẹ ọvo vwẹ ukoko ota-ọta-a.",
  "landing.hierarchy.command": "Uvo-Iruo Egbe-vwo",
  "role.lgaCoordinator": "Osu-Usuerin LGA",
  "role.wardCoordinator": "Osu-Usuerin Ward",
  "role.puAgent": "Osẹ-riẹ-iruo Asoya Ẹserovwo",

  // ---- Landing / Campaign Studio workspace ----
  "landing.workspaceKicker": "Studio Egbe-vwo",
  "landing.workspaceHeading": "Obo eje ro fo kẹ egbe-vwo, vwẹ asoya-iruo oru-iruo ọvo.",

  // ---- Landing / What Exists Today ---- (categoryOperational/
  // categoryInDevelopment: same internally-disputed status as above —
  // source material's own first pass said keep these in English.)
  "landing.existsKicker": "Obo Rọ Rẹyen Nonẹ",
  "landing.existsHeading": "Oru-iruo, aweri-ẹru, kẹ o ro osẹ — a ghwẹre efa jẹ-ẹ.",
  "landing.categoryOperational": "Oru-iruo",
  "landing.categoryInDevelopment": "O ro osẹ",

  // ---- Landing / Architecture ----
  "landing.architectureKicker": "Oma-ẹchate ekpoko",
  "landing.architectureHeading": "Eku e se. Ẹfiamu kerẹ.",

  // ---- Landing / Open Source ---- (body paragraphs are NO_DEFENSIBLE_
  // PROPOSAL in the source material — legal/licensing text — correctly
  // absent below.)
  "landing.openSourceKicker": "Ekpoko re rhie fia",
  "landing.openSourceHeading": "Ni ekpoko na re.",

  // ---- Landing / Who It Is For ---- (nonAffiliation disclaimer is
  // NO_DEFENSIBLE_PROPOSAL — correctly absent, stays English.)
  "landing.whoKicker": "Kohwo Rọ Fọ Kẹ",
  "landing.audience.candidate": "Egbe-vwo ihwo-ẹphẹn",
  "landing.audience.directors": "Isu re egbe-vwo",
  "landing.audience.coordinators": "Isu-usuerin aghwẹre",
  "landing.audience.volunteers": "Ihwo-evwovwe",
  "landing.audience.observers": "Ikoko re eni-iruo",
  "landing.audience.opsTeams": "Ikoko-iruo ẹserovwo",

  // ---- Landing / Start ---- (startBody is NO_DEFENSIBLE_PROPOSAL —
  // onboarding-workflow prose, correctly absent, stays English.)
  "landing.startKicker": "Tonnọ",
  "landing.startHeading": "Ma egbe-vwo ElectionCanon wẹ.",

  // ---- Landing / Footer ----
  "landing.footerCopyright": "ElectionCanon — ekpoko re rhie fia vwẹ otọ AGPL-3.0.",
  "landing.viewSourceCta": "Ni umobe-isiẹ vwẹ GitHub →",

  // ---- Landing / The Difference ---- (NOTE: landing.differenceKicker/
  // Heading exist here but Landing.jsx itself does not yet call t() for
  // them — a PRE-EXISTING wiring gap this pass did not introduce or fix;
  // see docs/multilingual/UI-STRING-INVENTORY.md §5. These two keys are
  // therefore drafted but not yet visible in any language, Urhobo included.)
  "landing.differenceKicker": "Ughweriẹne",
  "landing.differenceHeading": "ElectionCanon ku obo rẹ e ghwariẹ phra gba.",

  // ---- Home / Overview ----
  "home.yourScope": "Asa-iruo wẹ",
  "home.yourElection": "Ẹserovwo wẹ",
  "home.noActiveResponsibility": "Responsibility active vo",
  "home.noActiveResponsibilityBody1": "Responsibility active vo mrẹ vwọ account rọwan.",
  "home.whatToDoNext": "Emu nẹ ke ru next?",
  "home.continuePreparation": "Tọ Preparation →",
  "home.whatNeedsAttention": "Emu nẹ Nomaso Nonẹ?",
  "home.allClear": "EMU FẸFẸ — Nomaso vo Nanãna.",
  // home.toneUrgent deliberately absent — see file header: the source
  // material's own author explicitly said "I would not ship this particular
  // term without Urhobo review." Honored as written; stays English.
  "home.toneWatch": "Nomaso",
  "action.inviteSomeone": "Kpe ohwó",
  "action.reviewHeading": "Mrẹ lẹ",
  "home.whatChanged": "Emu nẹ ewẹne?",
  "home.yourWards": "Ete rọwan",
  "home.yourPollingUnits": "Polling Units rọwan",
  // home.operationalStatus deliberately absent — see file header: the
  // source material's own author explicitly recommended keeping this
  // technical status label in English. Honored as written; stays English.
  "home.nextActionCandidateRegistered": "Kpe Candidate registration ru vwọ COMPLETE.",
  "home.nextActionWardAssignment": "Ruo Ete rọwan ọvo.",
  "home.nextActionWardStatusHealth": "Ta status nẹ Ete na vwọ nanãna.",
  "home.nextActionObserverAssignment": "Vwọ observer ọvo nẹ rọwan.",
  "home.nextActionReviewGaps": "Mrẹ readiness rọwan nẹ vo.",
});

export const UI_TRANSLATIONS = Object.freeze({ en, ha, ig, pcm, urh, yo });

// ---------- URHOBO v0.1 — PER-KEY PROVENANCE. Documentation/audit layer
// only, exactly like INTENTIONAL_FALLBACKS below — t()'s own resolution
// never consults this. Three honest values only (not the source material's
// original five-tier scheme, which this pass could not independently stand
// behind — see the urh object's own header for why):
//   SOURCE_VERIFIED              a cited dictionary source gives this word
//                                 for this sense (one key, unchanged).
//   UNVERIFIED                   an AI-assisted working construction with no
//                                 dictionary citation this project can check.
//                                 This is nearly everything below. NOT a
//                                 claim that the wording is wrong — only that
//                                 it is unconfirmed.
//   UNVERIFIED_INTERNALLY_DISPUTED  UNVERIFIED, AND the source material's own
//                                 first-pass draft explicitly recommended
//                                 keeping this exact concept in English
//                                 "until Urhobo contributors have reviewed"
//                                 it, before a later pass overrode that
//                                 under a citation that does not hold up.
//                                 Priority community-review candidates.
// Full per-key basis/confidence notes from the source material live in
// docs/multilingual/URHOBO-UI-PROPOSED-v0.1.md.
export const URHOBO_PROPOSAL_STATUS = Object.freeze({
  "studio.languageHeading": "SOURCE_VERIFIED",
  "landing.heroHeadline": "UNVERIFIED",
  "landing.heroSubheadline": "UNVERIFIED",
  "landing.ctaStart": "UNVERIFIED",
  "landing.ctaHowItWorks": "UNVERIFIED",
  "landing.problemKicker": "UNVERIFIED",
  "landing.problemHeading": "UNVERIFIED",
  "landing.problemTag.whatsapp": "UNVERIFIED",
  "landing.problemTag.calls": "UNVERIFIED",
  "landing.problemTag.spreadsheets": "UNVERIFIED",
  "landing.problemTag.volunteers": "UNVERIFIED",
  "landing.problemTag.responsibility": "UNVERIFIED",
  "landing.problemTag.territory": "UNVERIFIED",
  "landing.problemTag.mobilisation": "UNVERIFIED",
  "landing.canonKicker": "UNVERIFIED",
  "landing.canonHeading": "UNVERIFIED",
  "landing.chainAction": "UNVERIFIED",
  "landing.chainEvent": "UNVERIFIED_INTERNALLY_DISPUTED",
  "landing.chainRecord": "UNVERIFIED_INTERNALLY_DISPUTED",
  "landing.howItWorksKicker": "UNVERIFIED",
  "landing.howItWorksHeading": "UNVERIFIED",
  "landing.step.election": "UNVERIFIED",
  "territory.office": "UNVERIFIED",
  "territory.constituency": "UNVERIFIED",
  "landing.step.territory": "UNVERIFIED",
  "landing.step.organisation": "UNVERIFIED",
  "landing.step.responsibility": "UNVERIFIED_INTERNALLY_DISPUTED",
  "nav.readiness": "UNVERIFIED_INTERNALLY_DISPUTED",
  "nav.chat": "UNVERIFIED",
  "landing.step.electionDay": "UNVERIFIED_INTERNALLY_DISPUTED",
  "landing.hierarchyKicker": "UNVERIFIED",
  "landing.hierarchyHeading": "UNVERIFIED",
  "landing.hierarchy.command": "UNVERIFIED",
  "role.lgaCoordinator": "UNVERIFIED",
  "role.wardCoordinator": "UNVERIFIED",
  "role.puAgent": "UNVERIFIED",
  "landing.workspaceKicker": "UNVERIFIED",
  "landing.workspaceHeading": "UNVERIFIED",
  "landing.existsKicker": "UNVERIFIED",
  "landing.existsHeading": "UNVERIFIED",
  "landing.categoryOperational": "UNVERIFIED_INTERNALLY_DISPUTED",
  "landing.categoryInDevelopment": "UNVERIFIED_INTERNALLY_DISPUTED",
  "landing.architectureKicker": "UNVERIFIED",
  "landing.architectureHeading": "UNVERIFIED",
  "landing.openSourceKicker": "UNVERIFIED",
  "landing.openSourceHeading": "UNVERIFIED",
  "landing.whoKicker": "UNVERIFIED",
  "landing.audience.candidate": "UNVERIFIED",
  "landing.audience.directors": "UNVERIFIED",
  "landing.audience.coordinators": "UNVERIFIED",
  "landing.audience.volunteers": "UNVERIFIED",
  "landing.audience.observers": "UNVERIFIED",
  "landing.audience.opsTeams": "UNVERIFIED",
  "landing.startKicker": "UNVERIFIED",
  "landing.startHeading": "UNVERIFIED",
  "landing.footerCopyright": "UNVERIFIED",
  "landing.viewSourceCta": "UNVERIFIED",
  "landing.differenceKicker": "UNVERIFIED",
  "landing.differenceHeading": "UNVERIFIED",
  "home.yourScope": "UNVERIFIED",
  "home.yourElection": "UNVERIFIED",
  "home.noActiveResponsibility": "UNVERIFIED",
  "home.noActiveResponsibilityBody1": "UNVERIFIED",
  "home.whatToDoNext": "UNVERIFIED",
  "home.continuePreparation": "UNVERIFIED",
  "home.whatNeedsAttention": "UNVERIFIED",
  "home.allClear": "UNVERIFIED",
  "home.toneWatch": "UNVERIFIED",
  "action.inviteSomeone": "UNVERIFIED",
  "action.reviewHeading": "UNVERIFIED",
  "home.whatChanged": "UNVERIFIED",
  "home.yourWards": "UNVERIFIED",
  "home.yourPollingUnits": "UNVERIFIED",
  "home.nextActionCandidateRegistered": "UNVERIFIED",
  "home.nextActionWardAssignment": "UNVERIFIED",
  "home.nextActionWardStatusHealth": "UNVERIFIED",
  "home.nextActionObserverAssignment": "UNVERIFIED",
  "home.nextActionReviewGaps": "UNVERIFIED",
});

// ---------- PASS 2 — DOCUMENTED ENGLISH FALLBACKS. A key that falls back
// to English for a given language is either (a) genuinely not yet gotten
// to, which is a real gap, or (b) a deliberate decision this project made
// and documented. This registry exists so a test — or a human — can tell
// the two apart, rather than every missing key looking identically
// "incomplete." t()'s own resolution (UI_TRANSLATIONS[lang] -> en -> key)
// is completely unaffected; this is a documentation/audit layer only.
//
// readiness.countTemplate.* (R05, all five languages): correct
// pluralization rules differ across Hausa/Igbo/Yoruba/Pidgin/Urhobo — a
// naive {n} substitution would force English's simple "-s" grammar onto
// languages that mark plurality completely differently (or, for Pidgin,
// often not at all on the noun itself), which is exactly the kind of
// fabricated-confidence grammar this project refuses to ship. Deferred
// until a correct per-language (or per-count-class) template exists.
const PLURAL_GRAMMAR_DEFERRED_KEYS = Object.freeze([
  "readiness.countTemplate.people",
  "readiness.countTemplate.wards",
  "readiness.countTemplate.pollingUnits",
  "readiness.countTemplate.agents",
  "readiness.countTemplate.assignmentsTasks",
  "readiness.countTemplate.results",
  "readiness.countTemplate.incidents",
]);

export const INTENTIONAL_FALLBACKS = Object.freeze({
  ha: PLURAL_GRAMMAR_DEFERRED_KEYS,
  ig: PLURAL_GRAMMAR_DEFERRED_KEYS,
  pcm: PLURAL_GRAMMAR_DEFERRED_KEYS,
  yo: PLURAL_GRAMMAR_DEFERRED_KEYS,
  // Urhobo: the sentinel, not a key list — see the `urh` object's own
  // header above. This project's sourced Urhobo research has no attested
  // vocabulary for nearly any ElectionCanon UI concept, and this pass
  // refused to invent any to reach a coverage number. EVERY key Urhobo
  // does not define (i.e. everything except "studio.languageHeading") is
  // therefore an intentional fallback, not an oversight — expressed as a
  // sentinel rather than a hand-maintained list so it never drifts out of
  // date as new UI keys are added. Native Urhobo-speaking contributors:
  // adding a genuinely sourced word moves it OUT of fallback automatically
  // the moment it's added to the `urh` object above.
  urh: "ALL_UNDRAFTED",
});

/** True if `key` falling back to English for `lang` is a documented
 *  decision (see INTENTIONAL_FALLBACKS above), not an unflagged gap. */
export function isIntentionalFallback(key, lang) {
  const policy = INTENTIONAL_FALLBACKS[lang];
  if (!policy) return false;
  if (policy === "ALL_UNDRAFTED") return !(key in (UI_TRANSLATIONS[lang] ?? {}));
  return policy.includes(key);
}

// ---------- SAFETY-GATED KEYS — see file header. Each requires its own
// explicit `approved: true` (set only after native review, exactly like a
// response template) before ANY language but English is ever returned for
// it, regardless of whether a draft value exists above.
export const SAFETY_GATED_KEYS = Object.freeze([
  "electionDay.simDisclosure",
  "electionDay.simPhotoDisclosure",
  "electionDay.simResultsDisclosure",
  "studio.noAiImageDisclosure",
  "ask.languageFallbackBanner",
]);

// Mirrors responses.js's own `approved: false` invariant exactly — every
// safety-gated key, for every non-English language, starts false and
// stays false until a native reviewer says otherwise. No code here ever
// flips one of these; only a human editing this object does.
const SAFETY_GATED_APPROVALS = Object.freeze(
  Object.fromEntries(SAFETY_GATED_KEYS.map((k) => [k, Object.freeze({ ha: false, ig: false, pcm: false, urh: false, yo: false })])),
);

/** Fills `{var}` placeholders in a resolved string — same mechanism as
 *  respond.js's own fill(), never string concatenation or eval. */
function interpolate(str, vars) {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (_, key) => (key in vars ? String(vars[key]) : `{${key}}`));
}

/**
 * THE ONLY PRODUCTION ACCESSOR for ElectionCanon UI strings.
 *
 * Resolution order for an ordinary key: requested language -> English ->
 * the key itself (so a typo'd/missing key is visibly wrong, never a blank
 * UI or a crash — same defensive floor os/i18n.js's own t() already uses).
 *
 * For a SAFETY_GATED key: English, always, unless SAFETY_GATED_APPROVALS
 * explicitly marks that exact key approved for that exact language — the
 * draft value in UI_TRANSLATIONS is never consulted otherwise, however
 * confident-looking it is.
 */
export function t(key, lang = DEFAULT_LANGUAGE, vars = null) {
  const safeLang = isSupportedLanguageCode(lang) ? lang : DEFAULT_LANGUAGE;
  if (SAFETY_GATED_KEYS.includes(key)) {
    const approved = SAFETY_GATED_APPROVALS[key]?.[safeLang];
    const resolved = approved ? (UI_TRANSLATIONS[safeLang]?.[key] ?? en[key] ?? key) : (en[key] ?? key);
    return interpolate(resolved, vars);
  }
  const resolved = UI_TRANSLATIONS[safeLang]?.[key] ?? en[key] ?? key;
  return interpolate(resolved, vars);
}

export default { UI_TRANSLATIONS, SAFETY_GATED_KEYS, INTENTIONAL_FALLBACKS, isIntentionalFallback, URHOBO_PROPOSAL_STATUS, t };

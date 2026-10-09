// ============================================================
// OUTREACH ACTIVATION — CAMPAIGN ASSETS  (Phase 9)
//
// Seven reusable follow-up/response templates (A-G), each a pure
// renderAsset(code, contact) -> {subject, body} function. No network
// call, no fetch, no Deno/Supabase import anywhere in this file --
// rendering a message and sending it are two different, independently
// reviewable steps (see followup.js's own header on why SEND is a human
// attestation, never a dispatch).
//
// TRUTHFULNESS. Every template points only at the three real, current
// assets the outreach brief names:
//   production   https://electioncanon.org
//   source       https://github.com/electioncanon-commons/electioncanon
//   public demo  https://demo.electioncanon.org/demo (synthetic/editorial,
//                not live production data -- said explicitly in F below)
// No template claims an independent security audit, a penetration test,
// "six fully localized rooms," organizational adoption/product-market
// fit, a live geography RLS fix, or WCAG compliance -- none of those
// words appear anywhere in this file. Multilingual work is deliberately
// NOT mentioned here at all rather than asserted at an uncertain maturity
// level -- see [[project-a7-creative-studio-language]] in memory for why
// language-completeness claims need to stay conservative.
//
// REFERENCES THE PREVIOUS INTERACTION WHERE KNOWN (Phase 5). Every
// template takes the actual contact record and only asserts what it
// actually contains -- a known sentAt becomes a real date in the
// sentence; an unknown one falls back to a generic, still-true phrase
// ("the note we sent you") instead of a fabricated date.
// ============================================================

export const ASSET_CODE = Object.freeze([
  "A_INSTITUTIONAL_FOLLOWUP",
  "B_CIVIC_TECH_FOLLOWUP",
  "C_MEDIA_FOLLOWUP",
  "D_OPEN_SOURCE_FOLLOWUP",
  "E_ACKNOWLEDGEMENT_FOLLOWUP",
  "F_DEMO_REQUEST_RESPONSE",
  "G_CONVERSATION_REQUEST_RESPONSE",
]);

export const ASSET_LABEL = Object.freeze({
  A_INSTITUTIONAL_FOLLOWUP: "Institutional follow-up",
  B_CIVIC_TECH_FOLLOWUP: "Civic-tech follow-up",
  C_MEDIA_FOLLOWUP: "Media follow-up",
  D_OPEN_SOURCE_FOLLOWUP: "Open-source / developer follow-up",
  E_ACKNOWLEDGEMENT_FOLLOWUP: "Acknowledgement follow-up",
  F_DEMO_REQUEST_RESPONSE: "Demo-request response",
  G_CONVERSATION_REQUEST_RESPONSE: "Conversation-request response",
});

export const PRODUCTION_URL = "https://electioncanon.org";
export const SOURCE_URL = "https://github.com/electioncanon-commons/electioncanon";
export const DEMO_URL = "https://demo.electioncanon.org/demo";

/** Default asset for a contact that hasn't responded yet, based on sector (Phase 5). */
const SECTOR_DEFAULT_ASSET = Object.freeze({
  media: "C_MEDIA_FOLLOWUP",
  civic_tech: "B_CIVIC_TECH_FOLLOWUP",
  democracy_election_org: "A_INSTITUTIONAL_FOLLOWUP",
  development_org: "A_INSTITUTIONAL_FOLLOWUP",
  open_source_dev: "D_OPEN_SOURCE_FOLLOWUP",
  institutional_partner: "A_INSTITUTIONAL_FOLLOWUP",
  other: "A_INSTITUTIONAL_FOLLOWUP",
});

/**
 * Picks the asset code a contact's CURRENT state implies -- a demo
 * request or a conversation request overrides the sector default,
 * because the contact told us something more specific than their sector.
 */
export function defaultAssetCodeForContact(contact) {
  if (!contact) return "A_INSTITUTIONAL_FOLLOWUP";
  if (contact.status === "DEMO") return "F_DEMO_REQUEST_RESPONSE";
  if (contact.status === "CONVERSATION") return "G_CONVERSATION_REQUEST_RESPONSE";
  if (contact.status === "RESPONDED") return "E_ACKNOWLEDGEMENT_FOLLOWUP";
  return SECTOR_DEFAULT_ASSET[contact.sector] || "A_INSTITUTIONAL_FOLLOWUP";
}

function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function priorReference(contact) {
  const date = formatDate(contact?.sentAt);
  if (date && contact?.subject) return `the note we sent on ${date} ("${contact.subject}")`;
  if (date) return `the note we sent on ${date}`;
  return "the note we sent you";
}

function orgLine(contact) {
  return contact?.organization || "your organization";
}

const SIGNOFF = `\n\nElectionCanon\n${PRODUCTION_URL}\nSource: ${SOURCE_URL}`;

function renderInstitutional(contact) {
  return {
    subject: `Following up: ElectionCanon for ${orgLine(contact)}`,
    body: `Hello${contact?.recipientName ? ` ${contact.recipientName}` : ""},\n\n`
      + `I'm writing to follow up on ${priorReference(contact)} about ElectionCanon, an open-source election readiness, mobilization, and election-day operations system.\n\n`
      + `If it's useful, I'm happy to walk your team through what's built so far -- the production site and full source are both linked below, and there's a public demo you can click through on your own first.\n\n`
      + `Demo: ${DEMO_URL}\n\nWould a short call make sense on your end?${SIGNOFF}`,
  };
}

function renderCivicTech(contact) {
  return {
    subject: `ElectionCanon follow-up -- source + demo for ${orgLine(contact)}`,
    body: `Hi${contact?.recipientName ? ` ${contact.recipientName}` : ""},\n\n`
      + `Circling back on ${priorReference(contact)}. ElectionCanon is open-source (AGPL-3.0) -- the full repo is linked below if you'd rather read the code than take our word for anything.\n\n`
      + `Source: ${SOURCE_URL}\nDemo: ${DEMO_URL}\n\n`
      + `Genuinely curious what a civic-tech team like yours would want to see next, or poke holes in -- open to a conversation whenever works.${SIGNOFF}`,
  };
}

function renderMedia(contact) {
  return {
    subject: `Following up -- ElectionCanon story angle for ${orgLine(contact)}`,
    body: `Hello${contact?.recipientName ? ` ${contact.recipientName}` : ""},\n\n`
      + `Following up on ${priorReference(contact)}. ElectionCanon is an open-source election operating system, and the public demo below is the fastest way to see it firsthand before any conversation:\n\n`
      + `Demo: ${DEMO_URL}\n\n`
      + `Happy to answer questions on background, point you to the source, or set up time to talk through it if there's a story here.${SIGNOFF}`,
  };
}

function renderOpenSource(contact) {
  return {
    subject: `ElectionCanon -- following up on ${orgLine(contact)}`,
    body: `Hey${contact?.recipientName ? ` ${contact.recipientName}` : ""},\n\n`
      + `Following up on ${priorReference(contact)}. The repo's open for reading, issues, and PRs:\n\n`
      + `Source: ${SOURCE_URL}\nDemo: ${DEMO_URL}\n\n`
      + `If anything in there looks interesting (or broken), I'd genuinely like to hear it -- no pressure either way.${SIGNOFF}`,
  };
}

function renderAcknowledgement(contact) {
  return {
    subject: `Thanks for the reply -- ${orgLine(contact)}`,
    body: `Hello${contact?.recipientName ? ` ${contact.recipientName}` : ""},\n\n`
      + `Thank you for getting back to us on ${priorReference(contact)}.\n\n`
      + `Whenever it's useful, here's the demo and the source so you can look at your own pace:\n\n`
      + `Demo: ${DEMO_URL}\nSource: ${SOURCE_URL}\n\n`
      + `Let me know if a closer look, a call, or anything else would help -- and just as happy to leave it here if now isn't the time.${SIGNOFF}`,
  };
}

function renderDemoResponse(contact) {
  return {
    subject: `Your ElectionCanon demo -- ${orgLine(contact)}`,
    body: `Hello${contact?.recipientName ? ` ${contact.recipientName}` : ""},\n\n`
      + `Here's the public demo you asked about:\n\n${DEMO_URL}\n\n`
      + `A quick note on what it is: it's a public, synthetic editorial demo -- built to show how the system works, not a live production election. The full source is here if you want to look under the hood:\n\n`
      + `Source: ${SOURCE_URL}\n\n`
      + `Happy to walk through it together on a call if that's useful, or you're welcome to explore it on your own first.${SIGNOFF}`,
  };
}

function renderConversationResponse(contact) {
  return {
    subject: `Setting up time to talk -- ${orgLine(contact)}`,
    body: `Hello${contact?.recipientName ? ` ${contact.recipientName}` : ""},\n\n`
      + `Glad to hear you'd like to talk -- following up on ${priorReference(contact)}.\n\n`
      + `Could you reply with a few times (and timezone) that would work for you? I'll find something that matches.\n\n`
      + `In the meantime, here's the demo and source in case useful before we speak:\n\nDemo: ${DEMO_URL}\nSource: ${SOURCE_URL}${SIGNOFF}`,
  };
}

const RENDERERS = Object.freeze({
  A_INSTITUTIONAL_FOLLOWUP: renderInstitutional,
  B_CIVIC_TECH_FOLLOWUP: renderCivicTech,
  C_MEDIA_FOLLOWUP: renderMedia,
  D_OPEN_SOURCE_FOLLOWUP: renderOpenSource,
  E_ACKNOWLEDGEMENT_FOLLOWUP: renderAcknowledgement,
  F_DEMO_REQUEST_RESPONSE: renderDemoResponse,
  G_CONVERSATION_REQUEST_RESPONSE: renderConversationResponse,
});

/** The single entry point every caller (UI, follow-up drafting, tests) uses -- never a second switch statement elsewhere. */
export function renderAsset(code, contact) {
  const renderer = RENDERERS[code];
  if (!renderer) return { valid: false, error: `unknown asset code: ${code}` };
  const { subject, body } = renderer(contact || {});
  return { valid: true, error: null, subject, body };
}

export default { ASSET_CODE, ASSET_LABEL, PRODUCTION_URL, SOURCE_URL, DEMO_URL, defaultAssetCodeForContact, renderAsset };

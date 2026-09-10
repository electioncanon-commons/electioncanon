// ============================================================
// FORGE ELECTION — CREATIVE COMMAND LAYER  (Gate A.7.5, foundation)
//
// THE PIPELINE THIS FILE OWNS (see the A.7 product direction's own
// architectural model):
//
//   natural-language instruction
//       |
//   interpretCreativeCommand()   <-- language-aware interpretation, THIS FILE
//       |
//   CreativeOperation (closed vocabulary, ONE member in V1)
//       |
//   applyCreativeOperation()     <-- LANGUAGE-INDEPENDENT apply, THIS FILE
//       |
//   a new CreativeComposition, still subject to the EXISTING
//   validateCreativeComposition() (composition.js) before it may render —
//   this file never bypasses that gate, and never renders anything itself.
//
// DETERMINISTIC BY DESIGN, NOT A DEGRADED PLACEHOLDER FOR A FUTURE MODEL.
// Exactly the same precedent os/studio/ask.js's own header already
// establishes for "Ask ElectionCanon" (a deterministic adapter is the
// default and is fully, honestly supported on its own — a model-backed
// adapter is an OPTIONAL future upgrade, never a prerequisite for this
// layer to be real). Phrase-matching a closed, small vocabulary here is a
// genuine, working AI Creative Command Engine for the one operation it
// declares — not a stub waiting for an external provider. No AI vendor,
// no API key, and no network call exists anywhere in this file.
//
// ONE OPERATION IN V1, NOT A REPRESENTATIVE SAMPLE. Per the A.7 brief's own
// instruction ("choose the smallest operation set that proves the
// architecture"): CREATIVE_OPERATION_KIND declares exactly SET_ALIGNMENT —
// the one property design/composition.js's PROPERTY_SCHEMA already governs
// for the one element kind (TEXT) it already governs. Adding a second
// operation (position, scale, an image property once one exists) is a line
// in CREATIVE_OPERATION_KIND and a new `case` in applyCreativeOperation(),
// mirroring composition.js's own "adding a property is a line here" — never
// a generic `{property, value}` escape hatch that could set anything.
//
// ENGLISH ONLY, HONESTLY — MATCHING RESPOND.JS'S OWN PRECEDENT EXACTLY.
// domains/election/studio/respond.js's REALISERS deliberately has exactly
// one real language key ("en") even though detection covers six; this file
// makes the identical choice for the identical reason (test/
// language-capability.consumer.mjs's own D1/D2 already enforce "no intent
// fabricates a translation merely because a language was selected" for
// that file, and INTERPRETED_LANGUAGES below is this file's equivalent
// honesty marker). A message detected as confidently non-English is NEVER
// guessed at — interpretCreativeCommand() returns languageFellBack:true and
// a plain reason, never a fabricated match. Widening past English is real
// future work (native-reviewed phrase lists per language, same discipline
// A.7.12 of the brief asks for), not a schema change to this file.
//
// SELECTION CONTEXT, NEVER AN ELEMENT ID FROM THE USER (A.7.6). A command
// may name a role directly ("center the headline") or rely on whichever
// element is currently selected ("center this") — resolveTargetRole() below
// checks an explicit name first, then falls back to `selectedElementId`.
// Either way the caller never has to supply or expose a raw element id.
//
// CONSERVATIVE INTERPRETATION BOUNDARY (correctness fix). Matching an
// alignment word and a role synonym ANYWHERE in a message is not enough to
// call a message "understood" — ordinary prose can innocently contain both
// (e.g. "Explain the Middle East policy details in the body copy" contains
// both "middle" and "body"). Rather than growing the keyword lists (which
// cannot fix this — more words means more false positives, not fewer),
// interpretCreativeCommand() first checks hasInstructionShape(): the
// message must OPEN with one of a small closed set of design-instruction
// verbs (INSTRUCTION_OPENERS below — "center", "align", "move", "put",
// "make", the same discipline every other closed vocabulary in this
// codebase already uses). A message that does not open like an instruction
// is refused before alignment/role resolution ever runs, no matter what
// words appear later in it. Ambiguous language is never guessed at either:
// resolveAlignment() below refuses (returns null) when a message cues more
// than one alignment value, rather than picking one by object/array
// iteration order.
//
// NO DOM. NO TIMING. NO RENDERING. NO SUPABASE. This file only ever reads
// `template.textSlots` and a plain composition object — same discipline as
// composition.js/creative.js/motion.js/language.js (see design/render.js's
// own header; test/election-web-adapter.consumer.mjs's F2 check scans this
// entire directory tree).
// ============================================================

import { detectLanguage } from "../../../os/studio/language.js";
import { ELEMENT_KIND, TEXT_ALIGNMENT, TEXT_ALIGNMENT_LIST } from "./composition.js";

// GATE A.7.2B — SET_OPACITY joins SET_ALIGNMENT: a second UI-originated
// structured operation, still exactly the "smallest operation set that
// proves the architecture" discipline this file's own header documents —
// one property per element kind (alignment for TEXT, opacity for IMAGE),
// never a generic {property, value} escape hatch. Unlike SET_ALIGNMENT,
// SET_OPACITY is never reachable from interpretCreativeCommand() at all in
// this gate — it is constructed directly by the UI control that owns it
// (MotionPreview.jsx) and handed straight to applyCreativeOperation(),
// deliberately bypassing natural-language interpretation entirely (a
// slider is not typed text — see this gate's own report on why no
// natural-language image command exists yet). This is still "the same
// operation path" the A.7 brief's future AI-operations architecture asks
// for: applyCreativeOperation() does not know or care whether its input
// came from a click, a slider, typed English, or a future model — only
// interpretCreativeCommand() (the language layer) is command-specific.
export const CREATIVE_OPERATION_KIND = Object.freeze({ SET_ALIGNMENT: "SET_ALIGNMENT", SET_OPACITY: "SET_OPACITY" });
export const CREATIVE_OPERATION_KIND_LIST = Object.freeze(Object.values(CREATIVE_OPERATION_KIND));

// The one honesty marker this file carries — see the header above. Widening
// this array is only ever correct alongside real, reviewed phrase lists for
// the added language, never on its own.
export const INTERPRETED_LANGUAGES = Object.freeze(["en"]);

// Deliberately narrow, reviewed English phrasing — not a generalised
// synonym engine. "middle"/"center"/"centre" for CENTER, "left" for LEFT;
// nothing here guesses at a word it has not been explicitly given.
const ALIGNMENT_PHRASES = Object.freeze({
  // (?:ed)? covers the adjectival inflection ("make it centered") as the
  // exact same word, not a new synonym — /\bcent(er|re)\b/ alone never
  // matches "centered" (no word boundary between "center" and "ed").
  [TEXT_ALIGNMENT.CENTER]: [/\bcent(?:er|re)(?:ed)?\b/i, /\bmiddle\b/i],
  [TEXT_ALIGNMENT.LEFT]: [/\bleft\b/i],
});

// Role names/synonyms drawn only from the labels the 3 approved
// CREATIVE_TEMPLATES families actually declare (templates.js) — "role" here
// always means a template.textSlots id, and a synonym is only ever
// consulted if the CURRENT template actually declares that role (see
// resolveTargetRole() below), so this table can never name a role a
// template doesn't have.
const ROLE_SYNONYMS = Object.freeze({
  headline: [/\bheadlines?\b/i, /\bheadings?\b/i, /\bstatements?\b/i, /\btitles?\b/i],
  body: [/\bbody\b/i, /\bsupporting( line)?\b/i, /\bdetails?\b/i],
  cta: [/\bcall[\s-]?to[\s-]?actions?\b/i, /\bcta\b/i, /\bbuttons?\b/i],
});

// The closed set of English verbs/verb-phrases that open a genuine design
// instruction — see the header's "CONSERVATIVE INTERPRETATION BOUNDARY"
// section. A leading "please" is stripped before matching. This list is
// deliberately small and explicit, same discipline as ALIGNMENT_PHRASES/
// ROLE_SYNONYMS above: adding a new accepted opening is a line here, never
// a generic "does this sentence sound like a command" heuristic.
const INSTRUCTION_OPENERS = Object.freeze([
  /^align\b/i,
  /^left[\s-]?align\b/i,
  /^cent(?:er|re)\b/i,
  /^move\b/i,
  /^put\b/i,
  /^make\b/i,
]);

function hasInstructionShape(text) {
  const stripped = text.replace(/^please\s+/i, "");
  return INSTRUCTION_OPENERS.some((re) => re.test(stripped));
}

// Order-independent by construction: counts EVERY alignment value the
// message cues, rather than returning the first match under some list's
// iteration order. Exactly one cue resolves; zero or MORE THAN ONE both
// resolve to null (no cue found / ambiguous) — a message is never guessed
// at just because it happens to mention two conflicting directions.
function resolveAlignment(text) {
  const matches = TEXT_ALIGNMENT_LIST.filter((value) => ALIGNMENT_PHRASES[value].some((re) => re.test(text)));
  return matches.length === 1 ? matches[0] : null;
}

function resolveTargetRole({ text, template, selectedElementId }) {
  const declaredRoles = new Set((template?.textSlots ?? []).map((s) => s.id));
  for (const [role, patterns] of Object.entries(ROLE_SYNONYMS)) {
    if (declaredRoles.has(role) && patterns.some((re) => re.test(text))) return role;
  }
  if (selectedElementId && declaredRoles.has(selectedElementId)) return selectedElementId;
  return null;
}

/** Interprets one natural-language instruction into a structured
 *  CreativeOperation, or an honest explanation of why it could not.
 *  Never mutates `template`, never touches a composition — resolving WHAT
 *  should change is kept strictly separate from actually changing it
 *  (applyCreativeOperation(), below), matching every other design/ module's
 *  own "resolve, then apply" split. Always returns the SAME shape,
 *  regardless of outcome:
 *
 *    { understood, operation, reason, detectedLanguage, languageFellBack }
 *
 *  `operation` is non-null only when `understood` is true. `languageFellBack`
 *  is true only when the message was CONFIDENTLY detected as a language
 *  other than English — never for an uncertain/short/ambiguous read, which
 *  is treated as English and given the chance to match (the same
 *  precedence discipline os/studio/language.js's own resolveResponseLanguage()
 *  already documents: a confident read is trusted, an uncertain one is not
 *  allowed to override the default). */
export function interpretCreativeCommand({ message, template = null, selectedElementId = null } = {}) {
  const text = String(message ?? "").trim();
  const detected = detectLanguage(text);

  if (!text) {
    return Object.freeze({
      understood: false, operation: null,
      reason: "Say what you'd like to change.",
      detectedLanguage: null, languageFellBack: false,
    });
  }

  const languageFellBack = Boolean(detected.language && detected.language !== "en" && !detected.uncertain);
  if (languageFellBack) {
    return Object.freeze({
      understood: false, operation: null,
      reason: "Creative commands are only understood in English right now.",
      detectedLanguage: detected.language, languageFellBack: true,
    });
  }

  if (!hasInstructionShape(text)) {
    return Object.freeze({
      understood: false, operation: null,
      reason: 'I could not find a design instruction in that (try something like "center the headline").',
      detectedLanguage: detected.language, languageFellBack: false,
    });
  }

  const alignment = resolveAlignment(text);
  if (!alignment) {
    return Object.freeze({
      understood: false, operation: null,
      reason: 'I could not find an alignment instruction in that (try "center" or "left").',
      detectedLanguage: detected.language, languageFellBack: false,
    });
  }

  const targetRole = resolveTargetRole({ text, template, selectedElementId });
  if (!targetRole) {
    return Object.freeze({
      understood: false, operation: null,
      reason: 'Select an element first, or name it directly (for example, "headline").',
      detectedLanguage: detected.language, languageFellBack: false,
    });
  }

  return Object.freeze({
    understood: true,
    operation: Object.freeze({ kind: CREATIVE_OPERATION_KIND.SET_ALIGNMENT, targetRole, alignment }),
    reason: null,
    detectedLanguage: detected.language, languageFellBack: false,
  });
}

/** Applies an already-interpreted CreativeOperation to a composition,
 *  purely and immutably — never mutates `composition`, never reads a word
 *  of natural language, never re-detects anything. THIS is the
 *  "language-independent" half of the pipeline the A.7 brief asks for:
 *  the exact same operation object produces the exact same resulting
 *  composition no matter what language, or input method, produced it.
 *  Returns { applied, error, composition } — `composition` is non-null only
 *  when `applied` is true. Structurally the same immutable
 *  `elements.map()` update MotionPreview.jsx's own manual alignment
 *  control already performs — this is not a second way to change an
 *  element's alignment, it is the SAME change, reachable from a sentence
 *  instead of a button. */
export function applyCreativeOperation({ operation, composition } = {}) {
  if (!operation || !CREATIVE_OPERATION_KIND_LIST.includes(operation.kind)) {
    return { applied: false, error: "Not a recognised creative operation.", composition: null };
  }
  if (!composition || !Array.isArray(composition.elements)) {
    return { applied: false, error: "Creative composition is missing or malformed.", composition: null };
  }

  // GATE A.6.3, widened A.7.2B — a plain sequence of guards, not a switch.
  // CREATIVE_OPERATION_KIND_LIST now has exactly two members and the guard
  // above already refuses any `operation.kind` outside them, so the final
  // fallback below remains provably unreachable dead code — it exists only
  // because a function like this should never silently fall through with
  // no return. Adding a third operation kind later is still a one-line
  // addition (a new top-level `if`), the same "adding a case is a line
  // here" discipline this file's own header already documents.
  //
  // GATE A.7.2B — ELEMENT KIND SAFETY. Both branches below resolve the
  // target element ONCE and check its `kind` before touching its
  // properties — SET_ALIGNMENT only ever applies to a TEXT element,
  // SET_OPACITY only ever to an IMAGE element. Before this gate,
  // SET_ALIGNMENT matched by role alone; had an operation ever named an
  // IMAGE role, it would have silently written a `properties.alignment`
  // key that element's own closed schema does not declare, and the
  // resulting composition would only fail much later, at
  // validateCreativeComposition() — a confusing, indirect failure for what
  // is really an operation-level mistake. Both branches now fail closed
  // immediately, with a clear, specific reason, instead.
  if (operation.kind === CREATIVE_OPERATION_KIND.SET_ALIGNMENT) {
    if (!TEXT_ALIGNMENT_LIST.includes(operation.alignment)) {
      return { applied: false, error: `"${operation.alignment}" is not a recognised alignment.`, composition: null };
    }
    const target = composition.elements.find((el) => el.role === operation.targetRole);
    if (!target) {
      return { applied: false, error: `No element with role "${operation.targetRole}" exists in this composition.`, composition: null };
    }
    if (target.kind !== ELEMENT_KIND.TEXT) {
      return { applied: false, error: `Element "${operation.targetRole}" is not a text element — alignment does not apply.`, composition: null };
    }
    const nextComposition = {
      ...composition,
      elements: composition.elements.map((el) =>
        el.role === operation.targetRole ? { ...el, properties: { ...el.properties, alignment: operation.alignment } } : el),
    };
    return { applied: true, error: null, composition: Object.freeze(nextComposition) };
  }
  if (operation.kind === CREATIVE_OPERATION_KIND.SET_OPACITY) {
    if (typeof operation.opacity !== "number" || !(operation.opacity >= 0) || !(operation.opacity <= 1)) {
      return { applied: false, error: `"${operation.opacity}" is not a valid opacity — it must be a number between 0 and 1.`, composition: null };
    }
    const target = composition.elements.find((el) => el.role === operation.targetRole);
    if (!target) {
      return { applied: false, error: `No element with role "${operation.targetRole}" exists in this composition.`, composition: null };
    }
    if (target.kind !== ELEMENT_KIND.IMAGE) {
      return { applied: false, error: `Element "${operation.targetRole}" is not an image element — opacity does not apply.`, composition: null };
    }
    const nextComposition = {
      ...composition,
      elements: composition.elements.map((el) =>
        el.role === operation.targetRole ? { ...el, properties: { ...el.properties, opacity: operation.opacity } } : el),
    };
    return { applied: true, error: null, composition: Object.freeze(nextComposition) };
  }
  return { applied: false, error: "Not a recognised creative operation.", composition: null };
}

export default {
  CREATIVE_OPERATION_KIND, CREATIVE_OPERATION_KIND_LIST, INTERPRETED_LANGUAGES,
  interpretCreativeCommand, applyCreativeOperation,
};

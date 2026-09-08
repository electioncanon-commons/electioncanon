// ============================================================
// FORGE ELECTION — CREATIVE COMPOSITION FOUNDATION  (Gate A.6.1)
//
// THE NEW SEAM:
//
//   Template
//       |
//   defaultCompositionFor(template, format)
//       |
//   CreativeComposition   <-- this file
//       |
//   renderCompositionToCanvas()   (design/render.js)
//
// A CreativeComposition is a SEPARATE, SIBLING value to PublicCreativePayload
// (design/creative.js) and to MotionSpecification (design/motion.js) — never
// a field on either, and neither of those two files is modified by this
// gate. This is the SAME precedent motion.js's own header already
// established for MotionSpecification: content (payload), timing (motion),
// and now composition (visual arrangement) each travel alongside one
// another into a renderer, never nested inside each other.
//
// CLOSED ELEMENT VOCABULARY, NOT A LAYOUT ENGINE. An element is a fixed,
// named, code-owned kind with a fixed, closed property schema — never a
// generic `style: {}` escape hatch, never free x/y, never a pixel font
// size, never an arbitrary colour, never a transform. See ELEMENT_KIND and
// TEXT_ALIGNMENT below for the entire V1 vocabulary — nothing else exists.
//
// V1 SCOPE — TEXT ONLY. Background and brand remain exactly what they are
// today: template/payload-driven, drawn by design/render.js's own
// drawBackground()/computeBrandLine(), never modeled as elements here. A
// future gate may promote them to elements (or add an "artifact" kind) —
// this file does not need to anticipate that shape, only avoid making it
// hard (see this file's own defaultCompositionFor(), which only ever
// derives from template.textSlots — extending the element vocabulary later
// is additive, not a rewrite of this function's own logic).
//
// SCOPED TO CREATIVE_TEMPLATES ONLY. The legacy 21 TEMPLATES/ASSET_TYPE
// gallery (design/templates.js's own freeform Design-tab templates) never
// participates in this system — exactly like motion support (design/
// motion.js) was already scoped to CREATIVE_TEMPLATES only. Nothing here
// reads or references TEMPLATES/ASSET_TYPE at all.
//
// NO DOM. NO TIMING. NO RENDERING. This file must never call
// requestAnimationFrame/setInterval/Date.now, never touch `document`/
// `window`, never create or receive a canvas — src/domains/election/ is a
// structurally-enforced DOM-free boundary (see design/render.js's own
// header; test/election-web-adapter.consumer.mjs's F2 check recursively
// scans this entire directory tree, this file included).
//
// This module is also Supabase-free and a pure function of its inputs —
// same discipline as design/creative.js and design/motion.js. Nothing here
// ever reads campaign metadata, a database row, or an application object —
// defaultCompositionFor() reads ONLY `template.textSlots`, never a payload,
// an asset, or anything campaign-scoped.
// ============================================================

import { CREATIVE_FORMAT } from "./templates.js";

export const ELEMENT_KIND = Object.freeze({ TEXT: "text" });
export const ELEMENT_KIND_LIST = Object.freeze(Object.values(ELEMENT_KIND));

export const TEXT_ALIGNMENT = Object.freeze({ LEFT: "left", CENTER: "center" });
export const TEXT_ALIGNMENT_LIST = Object.freeze(Object.values(TEXT_ALIGNMENT));

const CREATIVE_FORMAT_LIST = Object.freeze(Object.values(CREATIVE_FORMAT));

// The fixed, closed property schema PER ELEMENT KIND. Adding a property (or
// a kind) means adding a line here, in the open, never a generic/pluggable
// schema mechanism — same discipline design/motion.js's own closed preset
// vocabulary already established.
const PROPERTY_SCHEMA = Object.freeze({
  [ELEMENT_KIND.TEXT]: Object.freeze({
    alignment: (value) => TEXT_ALIGNMENT_LIST.includes(value),
  }),
});

/** Derives the V1 DEFAULT CreativeComposition for a CREATIVE_TEMPLATES
 *  family — one TEXT element per `template.textSlots` entry, in that exact
 *  declared order, `id` equal to `role` (V1 has no reason for a separate
 *  identifier scheme: elements are always 1:1 with slots here), alignment
 *  defaulting to "left" — the SAME horizontal position
 *  renderTemplateToCanvas()/computeTextLayout() have always used. Pure:
 *  never mutates `template`, reads nothing off any payload/asset/campaign
 *  object (it does not even accept one), and returns a fresh object every
 *  call. `format` is accepted as an explicit argument, never inferred or
 *  defaulted — the same "format always travels in from the caller,
 *  never guessed" convention design/creative.js's validateCreativePayload()
 *  and design/render.js's renderMotionFrameToCanvas() already use. */
export function defaultCompositionFor(template, format) {
  const textSlots = Array.isArray(template?.textSlots) ? template.textSlots : [];
  return {
    templateId: template?.id ?? null,
    format,
    elements: textSlots.map((slot) => ({
      id: slot.id,
      kind: ELEMENT_KIND.TEXT,
      role: slot.id,
      properties: { alignment: TEXT_ALIGNMENT.LEFT },
    })),
  };
}

const STRUCTURE_ERROR = { valid: false, error: "Creative composition is missing or malformed." };

/** The composition-side counterpart to design/creative.js's
 *  validateCreativePayload() and design/motion.js's
 *  validateMotionSpecification() — same shape, same philosophy:
 *  synchronous, deterministic, DOM-free, Supabase-free, never mutates
 *  `composition` or `template`, returns an honest {valid, error} naming the
 *  specific problem. A fixed sequence of explicit checks, not a generic
 *  schema/validation framework.
 *
 *  Checked, in order: structure; templateId matches the SELECTED template
 *  (never trusted from the composition alone); format is a recognised
 *  CREATIVE_FORMAT the template itself declares support for (the same
 *  template.formats allowlist validateCreativePayload() already checks);
 *  elements is an array; every element has well-formed identity fields, a
 *  recognised kind, a role the template ACTUALLY declares in its
 *  `textSlots`, and only properties that kind's own closed schema allows,
 *  each with a valid value; no duplicate element ids; and — the direct
 *  structural answer to "make an invalid V1 composition impossible to
 *  pass" — the element set is EXACTLY one element per declared textSlot,
 *  no fewer, no more, never a role appearing twice. */
export function validateCreativeComposition({ composition, template } = {}) {
  if (!composition || typeof composition !== "object") return STRUCTURE_ERROR;
  if (!Array.isArray(composition.elements)) return STRUCTURE_ERROR;
  if (!template || typeof template !== "object") return STRUCTURE_ERROR;

  if (composition.templateId !== template.id) {
    return { valid: false, error: `Composition templateId does not match template "${template.id}".` };
  }

  if (typeof composition.format !== "string" || !CREATIVE_FORMAT_LIST.includes(composition.format)) {
    return { valid: false, error: `"${composition.format}" is not a recognised creative format.` };
  }
  if (!Array.isArray(template.formats) || !template.formats.includes(composition.format)) {
    return { valid: false, error: `Template "${template.id}" does not support the "${composition.format}" format.` };
  }

  const declaredRoles = Array.isArray(template.textSlots) ? template.textSlots.map((s) => s.id) : [];
  const seenIds = new Set();
  const seenRoles = new Set();

  for (const element of composition.elements) {
    if (!element || typeof element !== "object") return STRUCTURE_ERROR;

    const { id, kind, role, properties } = element;
    if (typeof id !== "string" || !id.trim()) {
      return { valid: false, error: "Every composition element must have a non-empty string id." };
    }
    if (typeof role !== "string" || !role.trim()) {
      return { valid: false, error: "Every composition element must have a non-empty string role." };
    }
    if (!ELEMENT_KIND_LIST.includes(kind)) {
      return { valid: false, error: `"${kind}" is not a recognised element kind.` };
    }
    if (!declaredRoles.includes(role)) {
      return { valid: false, error: `Template "${template.id}" does not declare a "${role}" text slot.` };
    }
    if (seenIds.has(id)) {
      return { valid: false, error: `Duplicate element id "${id}".` };
    }
    seenIds.add(id);
    if (seenRoles.has(role)) {
      return { valid: false, error: `Duplicate element role "${role}".` };
    }
    seenRoles.add(role);

    if (!properties || typeof properties !== "object") return STRUCTURE_ERROR;
    const schema = PROPERTY_SCHEMA[kind];
    for (const [key, value] of Object.entries(properties)) {
      const isValid = schema?.[key];
      if (typeof isValid !== "function") {
        return { valid: false, error: `"${key}" is not a recognised property for element kind "${kind}".` };
      }
      if (!isValid(value)) {
        return { valid: false, error: `"${value}" is not a valid "${key}" value for element kind "${kind}".` };
      }
    }
  }

  if (seenRoles.size !== declaredRoles.length) {
    return { valid: false, error: `Composition must declare exactly one element per text slot on template "${template.id}".` };
  }

  return { valid: true, error: null };
}

export default {
  ELEMENT_KIND, ELEMENT_KIND_LIST, TEXT_ALIGNMENT, TEXT_ALIGNMENT_LIST,
  defaultCompositionFor, validateCreativeComposition,
};

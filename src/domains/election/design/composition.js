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
// size, never an arbitrary colour, never a transform. See ELEMENT_KIND,
// TEXT_ALIGNMENT and IMAGE_FIT below for the entire vocabulary — nothing
// else exists.
//
// GATE A.7.1 — IMAGE ELEMENT FOUNDATION. ELEMENT_KIND grows its second
// (and, for now, last) member: IMAGE. Exactly the same closed-vocabulary
// discipline as TEXT — a fixed property schema (`fit` only; see
// PROPERTY_SCHEMA below), no geometry, no asset/drawable reference stored
// here (see design/render.js's own IMAGE_GEOMETRY and its `drawables`
// parameter — WHICH image fills a role, and WHERE that role sits on the
// canvas, are both render-time/render-owned concerns, not composition
// data). Background and brand remain exactly what they were before this
// gate too: template/payload-driven, drawn by design/render.js's own
// drawBackground()/computeBrandLine(), never modeled as elements here.
// defaultCompositionFor()'s own extension (deriving IMAGE elements from
// `template.imageSlots`, the same shape as `textSlots`) is additive, not a
// rewrite of that function's pre-existing TEXT logic — exactly what this
// comment predicted before any second kind existed.
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

export const ELEMENT_KIND = Object.freeze({ TEXT: "text", IMAGE: "image" });
export const ELEMENT_KIND_LIST = Object.freeze(Object.values(ELEMENT_KIND));

export const TEXT_ALIGNMENT = Object.freeze({ LEFT: "left", CENTER: "center" });
export const TEXT_ALIGNMENT_LIST = Object.freeze(Object.values(TEXT_ALIGNMENT));

// GATE A.7.1 (IMAGE ELEMENT FOUNDATION) — exactly one supported fit mode.
// "cover" is the only crop behaviour that guarantees the declared
// destination rect is always fully covered regardless of the source
// image's own aspect ratio, with no letterbox-colour decision to make
// (contain) and no distortion risk (stretch) — both legitimate future
// additions, not a decision this foundation gate needs to make. A real,
// closed, growable enum (validated the same `.includes()` way as
// TEXT_ALIGNMENT_LIST), never a boolean or a free string.
export const IMAGE_FIT = Object.freeze({ COVER: "cover" });
export const IMAGE_FIT_LIST = Object.freeze(Object.values(IMAGE_FIT));

const CREATIVE_FORMAT_LIST = Object.freeze(Object.values(CREATIVE_FORMAT));

// The fixed, closed property schema PER ELEMENT KIND. Adding a property (or
// a kind) means adding a line here, in the open, never a generic/pluggable
// schema mechanism — same discipline design/motion.js's own closed preset
// vocabulary already established.
const PROPERTY_SCHEMA = Object.freeze({
  [ELEMENT_KIND.TEXT]: Object.freeze({
    alignment: (value) => TEXT_ALIGNMENT_LIST.includes(value),
  }),
  // GATE A.7.1 — an IMAGE element carries no geometry of its own (see
  // design/render.js's own IMAGE_GEOMETRY — a fixed, code-owned rect per
  // role, never a per-element x/y/width/height here — "do not introduce
  // arbitrary freeform pixel positioning controls") and no asset/drawable
  // reference either: this file stays Supabase-free and asset-free (see
  // this file's own header) — WHICH image fills a given role is a
  // render-time concern, resolved by the caller supplying render.js a
  // `drawables` map joined purely by `role`, the exact same join key TEXT
  // already uses against `payload.content[role]`.
  //
  // GATE A.7.2B — `opacity` joins `fit` as the second (and, for now, last)
  // IMAGE property: a plain number in [0, 1], validated by range rather
  // than `.includes()` — the first CONTINUOUS property in this file's
  // otherwise entirely closed-enum vocabulary (TEXT_ALIGNMENT, IMAGE_FIT).
  // This is deliberately still a small, bounded, deterministic range check,
  // not a new validation mechanism — `fit` stays a closed enum, `opacity`
  // is a bounded number, and no property beyond these two exists.
  [ELEMENT_KIND.IMAGE]: Object.freeze({
    fit: (value) => IMAGE_FIT_LIST.includes(value),
    opacity: (value) => typeof value === "number" && value >= 0 && value <= 1,
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
  // GATE A.7.1 — `template.imageSlots`, the SAME `[{id, label}]` shape as
  // `textSlots`, read the same defensive way. Appended AFTER every text
  // element (never interleaved) so every existing index-based assumption
  // about the TEXT elements' own relative order/position is unaffected.
  const imageSlots = Array.isArray(template?.imageSlots) ? template.imageSlots : [];
  return {
    templateId: template?.id ?? null,
    format,
    elements: [
      ...textSlots.map((slot) => ({
        id: slot.id,
        kind: ELEMENT_KIND.TEXT,
        role: slot.id,
        properties: { alignment: TEXT_ALIGNMENT.LEFT },
      })),
      ...imageSlots.map((slot) => ({
        id: slot.id,
        kind: ELEMENT_KIND.IMAGE,
        role: slot.id,
        // GATE A.7.2B — opacity defaults to fully opaque (1), the same
        // "default is the no-op/original value" precedent TEXT_ALIGNMENT.LEFT
        // already sets for text elements.
        properties: { fit: IMAGE_FIT.COVER, opacity: 1 },
      })),
    ],
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

  // Normalized on both sides (?? null) so an absent/undefined template.id
  // and this file's own defaultCompositionFor() (which normalizes a
  // missing template.id to templateId: null) always agree — the factory
  // and the validator must never disagree about what "no id" means.
  if ((composition.templateId ?? null) !== (template.id ?? null)) {
    return { valid: false, error: `Composition templateId does not match template "${template.id}".` };
  }

  if (typeof composition.format !== "string" || !CREATIVE_FORMAT_LIST.includes(composition.format)) {
    return { valid: false, error: `"${composition.format}" is not a recognised creative format.` };
  }
  if (!Array.isArray(template.formats) || !template.formats.includes(composition.format)) {
    return { valid: false, error: `Template "${template.id}" does not support the "${composition.format}" format.` };
  }

  // GATE A.7.1 — declared roles are now PER ELEMENT KIND: a template's
  // textSlots and imageSlots are two independent closed role lists, and an
  // element's role is only ever checked against ITS OWN kind's list —
  // never the other kind's. For a text-only template (imageSlots absent),
  // declaredRolesByKind[IMAGE] is simply [], and every check below behaves
  // EXACTLY as it did before this gate — this generalization is provably
  // behaviour-preserving for any composition with no image elements.
  const declaredRolesByKind = {
    [ELEMENT_KIND.TEXT]: Array.isArray(template.textSlots) ? template.textSlots.map((s) => s.id) : [],
    [ELEMENT_KIND.IMAGE]: Array.isArray(template.imageSlots) ? template.imageSlots.map((s) => s.id) : [],
  };
  const seenIds = new Set();
  const seenRolesByKind = { [ELEMENT_KIND.TEXT]: new Set(), [ELEMENT_KIND.IMAGE]: new Set() };

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
    if (!declaredRolesByKind[kind].includes(role)) {
      const slotWord = kind === ELEMENT_KIND.IMAGE ? "image slot" : "text slot";
      return { valid: false, error: `Template "${template.id}" does not declare a "${role}" ${slotWord}.` };
    }
    if (seenIds.has(id)) {
      return { valid: false, error: `Duplicate element id "${id}".` };
    }
    seenIds.add(id);
    const seenRoles = seenRolesByKind[kind];
    if (seenRoles.has(role)) {
      return { valid: false, error: `Duplicate element role "${role}".` };
    }
    seenRoles.add(role);

    // A plain object-like record only — not null (already excluded above),
    // not an array (Object.entries([]) is empty, which would otherwise let
    // an array silently pass with none of its required keys checked).
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) return STRUCTURE_ERROR;
    const schema = PROPERTY_SCHEMA[kind];
    for (const requiredKey of Object.keys(schema)) {
      if (!(requiredKey in properties)) {
        return { valid: false, error: `Element kind "${kind}" is missing its required "${requiredKey}" property.` };
      }
    }
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

  // GATE A.7.1 — the same structural-completeness check as before, now run
  // ONCE PER KIND: every declared role of that kind must have exactly one
  // element, no fewer, no more. For a template with no imageSlots this is
  // trivially satisfied (0 declared, 0 seen) — unchanged behaviour.
  for (const kind of ELEMENT_KIND_LIST) {
    if (seenRolesByKind[kind].size !== declaredRolesByKind[kind].length) {
      const slotWord = kind === ELEMENT_KIND.IMAGE ? "image slot" : "text slot";
      return { valid: false, error: `Composition must declare exactly one element per ${slotWord} on template "${template.id}".` };
    }
  }

  return { valid: true, error: null };
}

export default {
  ELEMENT_KIND, ELEMENT_KIND_LIST, TEXT_ALIGNMENT, TEXT_ALIGNMENT_LIST, IMAGE_FIT, IMAGE_FIT_LIST,
  defaultCompositionFor, validateCreativeComposition,
};

// ============================================================
// ELECTION FORGE — CAMPAIGN STUDIO: MOTION PREVIEW  (Gate A.5.5.3, extended Gates A.5.6/A.6)
//
// An EPHEMERAL, non-persisted demonstration surface for the 3 approved
// CREATIVE_TEMPLATES families (Statement/Hero, Announcement, CTA) — the
// only templates A.5.5.1 declared any motion support on. This is
// deliberately NOT persisted Studio asset authoring: nothing here ever
// calls assetsApi, nothing here reads or writes campaign_studio_assets,
// and closing this panel discards whatever was typed into it. The
// legacy 21 TEMPLATES/Editor flow (CampaignStudioSection.jsx's own
// Editor) is completely untouched by this file.
//
// GOVERNANCE — THE SAME PIPELINE, NOT A SHORTCUT. Ephemeral content still
// flows through the EXACT existing chain, never a parallel "preview
// payload" shape and never raw UI state handed straight to a renderer:
//
//   local ephemeral text
//     -> buildStudioCreativePayload()             (design/creative.js, unchanged)
//     -> validateCreativePayload()                (design/creative.js, unchanged)
//   local element/property state
//     -> defaultCompositionFor(template, format)  (design/composition.js, Gate A.6.1)
//     -> validateCreativeComposition()            (design/composition.js, Gate A.6.1)
//   local preset choice + fixed duration/fps/loop
//     -> validateMotionSpecification()            (design/motion.js, unchanged)
//     -> renderCompositionToCanvas()               static/settled  (design/render.js, Gate A.6.1/A.6.6)
//     -> renderCompositionMotionFrameToCanvas()    motion frames   (design/render.js, Gate A.6.5)
//
// buildStudioCreativePayload() was never legacy-specific — it already
// reads ANY template's own declared `textSlots` generically (see that
// function's own header) — so handing it a locally-shaped, in-memory
// `{content: {text: ...}}` object (never an `asset`, never saved) is not
// a new/parallel payload shape, just the same builder fed ephemeral
// input instead of a persisted one.
//
// NO MOTION MATH, NO LAYOUT MATH LIVES HERE. This file only ever calls
// design/timing.js's deriveTotalFrames()/frameIndexForElapsed() and
// design/render.js's exported renderers/geometry helper — it never
// computes an easing value, a progress fraction, or a text position
// itself. `performance.now()` is the ONLY wall-clock reference in this
// whole feature, and it stays here, at the page layer.
//
// ARTIFACT-READINESS (see the A.5.5/A.6 architecture reviews). This
// component knows only {canvas, template, payload, composition,
// motionSpec, frameIndex, totalFrames} — it has zero knowledge of what the
// renderer draws inside those calls. A future artifact-aware renderer
// signature would need no change here beyond passing one more prop
// through, and a future artifact element kind would need no change here
// beyond design/composition.js's own closed vocabulary growing by one.
//
// GATE A.6 — CREATIVE VIEWPORT. This surface evolved from a blind text
// form into a live, click-to-select viewport (Gate A.6.3: a DOM overlay
// positioned from design/render.js's own computeElementSelectionBounds() —
// the SAME geometry the renderer itself already computes, never a second
// layout calculation) with exactly ONE governed, controllable property
// (Gate A.6.4: per-element text alignment) and an Export PNG capability
// (Gate A.5.6, updated Gate A.6.6) that draws the exact SETTLED
// composition — via renderCompositionToCanvas(), never the motion
// renderer — onto a second, offscreen canvas, then encodes/downloads it
// via the existing canvasToPngBlob()/downloadBlob() helpers already proven
// by CampaignStudioSection.jsx's own exportPng() and communications/
// export.js's own exportApprovedVariant(). No second renderer, no second
// payload shape, no persistence: this component still never calls
// assetsApi or the Supabase client.
//
// GATE A.7.1 — LANGUAGE CONTEXT. Three independent settings (design/
// language.js's UserLanguageContext: interfaceLanguage, aiInteractionLanguage,
// creativeOutputLanguage), defaulted to English and changeable independently
// from design/language.js's own closed six-language list — the SAME registry
// os/studio/languageCapability.js already maintains for Ask ElectionCanon,
// never a second one. Honesty first: nothing in this component yet
// translates the interface, talks to an AI, or generates creative text in
// another language — these three controls exist so the architecture is
// language-ready (see the A.7 brief), and validateUserLanguageContext() is
// checked alongside payload/composition validation before Export PNG runs,
// the same "no canvas until every governed input is valid" discipline every
// other value in this pipeline already gets. No AI, no translation, no
// voice — see design/language.js's own header for what is deliberately not
// built yet.
//
// GATE A.7.5 — CREATIVE COMMAND BOX. A plain text input lets the user type
// an instruction ("center the headline") instead of clicking the alignment
// buttons — both paths call the exact same setComposition() with the exact
// same immutable update shape (design/creativeCommand.js's
// applyCreativeOperation() mirrors setSelectedAlignment()'s own
// elements.map()), so a command can never reach the canvas through a
// different, less-governed path than a click already uses. Understood only
// in English right now (design/creativeCommand.js's own INTERPRETED_LANGUAGES) —
// a non-English or unrecognised instruction is refused with a plain reason,
// never guessed at.
//
// FAMILY SWITCH IS AN ATOMIC, RENDER-PHASE RESET (correctness fix). Content/
// composition/preset/selection are reset the moment `familyKey` changes
// during THIS component's own render — a plain `if (familyKey !==
// resetForFamilyKey) { ...setState calls... }` at the top of the function
// body, not inside a `useEffect(() => {...}, [familyKey])`. React discards
// and immediately re-runs a render that calls setState during rendering,
// before that render's output is ever committed or any effect fires — so
// the live-preview effect below (keyed on [familyKey, ..., composition])
// can never observe "new family's template paired with the old family's
// composition," a combination an effect-based reset could momentarily let
// through (one commit where the template already changed but the
// asynchronous reset had not yet run). See React's own "adjusting state
// when a prop changes" pattern — this is that pattern, not a novel one.
//
// GATE A.7.2A — REAL IMAGE INPUT. A real local photo, not a placeholder:
// File -> createImageBitmap() -> {source, width, height} (the A.7.1
// drawable contract) -> `heroImage` state -> `drawables` -> the SAME
// unmodified renderCompositionToCanvas() the static viewport already used.
// `composition` itself is untouched by any of this — the `heroImage` ROLE
// it declares (A.7.1, Statement/Hero only) already exists; only the
// drawable filling that role is new. Never persisted, never an asset row,
// never Supabase Storage — same ephemeral contract as everything else in
// this file. Export PNG consumes the exact same `drawables` the live
// viewport just rendered (see onExportPng below) — a user can never see a
// photo on screen and download a PNG without it. Image motion is
// explicitly NOT implemented (see onPreviewMotion's own comment) — a
// chosen hero image is visible in the static viewport and in the export,
// not during "Preview motion" playback itself.
//
// EXPORT-ERROR LIFECYCLE (correctness fix). `exportError` is scoped to
// Export PNG specifically, but the conditions that make an export fail
// (bad content, an invalid composition, an unsupported family) are exactly
// the inputs this file's OTHER actions already correct. A dedicated effect
// below clears `exportError` whenever family/content/composition change —
// the same three "corrective action" categories this gate's own review
// named — so a stale export failure banner never survives a fix made
// through some other control (the alignment buttons, a creative command,
// simply editing a text field). Starting a fresh Export PNG attempt still
// clears and recomputes it independently, as it always has.
// ============================================================

import { useState, useRef, useEffect, useCallback } from "react";
import { CREATIVE_TEMPLATES, CREATIVE_FAMILY, CREATIVE_TEMPLATE_LIST, CREATIVE_FORMAT } from "../../domains/election/design/templates.js";
import { buildStudioCreativePayload, validateCreativePayload } from "../../domains/election/design/creative.js";
import { renderCompositionToCanvas, renderCompositionMotionFrameToCanvas, computeElementSelectionBounds, canvasToPngBlob } from "../../domains/election/design/render.js";
import { defaultCompositionFor, validateCreativeComposition, TEXT_ALIGNMENT_LIST } from "../../domains/election/design/composition.js";
import { validateMotionSpecification, MOTION_DURATION_MS, MOTION_FPS_OPTIONS } from "../../domains/election/design/motion.js";
import { deriveTotalFrames, frameIndexForElapsed } from "../../domains/election/design/timing.js";
import { CREATIVE_LANGUAGE_LIST, LANGUAGE_CONTEXT_FIELD, defaultUserLanguageContext, validateUserLanguageContext } from "../../domains/election/design/language.js";
import { interpretCreativeCommand, applyCreativeOperation } from "../../domains/election/design/creativeCommand.js";
import { Label, Panel, DemoTag, friendlyError, ensureCreativeFontsReady, downloadBlob, UI, IVORY, MUTED, TEAL, PINK, BORDER, BLACK, inputStyle } from "./shared.jsx";

// GATE A.5.6 — GOLDEN CREATIVE FORMAT. One canonical format/dimension pair
// for this surface's live preview AND its export — never two separate
// values that could silently drift apart. 1080x1350 (portrait) rather than
// A.5.5.3's original 1080x1080 (square): the approved Golden Creative
// vertical slice's own chosen format. Still not a user-facing choice (no
// format picker here — see design/creative.js's own CREATIVE_FORMAT/
// FORMAT_DIMENSIONS, which this deliberately does not import, matching the
// same small-table duplication precedent communications/export.js's own
// EXPORT_FORMATS already established, rather than reaching into that
// module's un-exported internal table).
const GOLDEN_FORMAT = CREATIVE_FORMAT.PORTRAIT;
const PREVIEW_DIMENSIONS = Object.freeze({ width: 1080, height: 1350 });

// Fixed, code-chosen motion defaults — not exposed to the user at all
// (the approved UX asks only for a preset choice, never duration/fps/loop
// controls). Clamped/validated against design/motion.js's own governed
// bounds/enum rather than trusted as disconnected literals, so a future
// change to those bounds can never silently leave this preview
// requesting an invalid specification.
const DEFAULT_DURATION_MS = Math.min(Math.max(1800, MOTION_DURATION_MS.MIN), MOTION_DURATION_MS.MAX);
const DEFAULT_FPS = MOTION_FPS_OPTIONS.includes(30) ? 30 : MOTION_FPS_OPTIONS[0];

const PRESET_LABEL = Object.freeze({ fade: "Fade", slideUp: "Slide up", staggerLines: "Staggered reveal" });
const ALIGNMENT_LABEL = Object.freeze({ left: "Left", center: "Center" });

// GATE A.7.2A — REAL IMAGE INPUT. A closed allow-list, checked against
// `file.type` BEFORE any decode is attempted — treat the file as untrusted
// input, same discipline design/electionDay/evidence.js's own ALLOWED_TYPES
// already established for result-evidence photos. HEIC is deliberately
// excluded here (unlike that file's upload-only path, which never needs to
// decode HEIC locally): createImageBitmap() support for HEIC is
// inconsistent across browsers, and this feature's whole point is local
// decode + render, not upload-as-captured.
const HERO_IMAGE_ALLOWED_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"]);

function emptyContentFor(template) {
  return Object.fromEntries(template.textSlots.map((s) => [s.id, ""]));
}

/** The one place this file builds a payload — always through the
 *  existing, unchanged buildStudioCreativePayload(), never a hand-rolled
 *  object handed straight to a renderer. `content` here is local React
 *  state, never persisted, never an `asset`. */
function buildEphemeralPayload(template, content) {
  return buildStudioCreativePayload({ asset: { content: { text: content } }, template, identity: {} });
}

export default function MotionPreview() {
  const [familyKey, setFamilyKey] = useState(CREATIVE_FAMILY.STATEMENT);
  const template = CREATIVE_TEMPLATES[familyKey];

  const [content, setContent] = useState(() => emptyContentFor(template));
  const [composition, setComposition] = useState(() => defaultCompositionFor(template, GOLDEN_FORMAT));
  const [preset, setPreset] = useState(template.motion.supportedPresets[0]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [selectionBounds, setSelectionBounds] = useState([]);
  const [selectedElementId, setSelectedElementId] = useState(null);
  // GATE A.7.1 — never reset by family switch: a session's language
  // choices are a property of the PERSON using the studio, not of whichever
  // creative family they happen to be looking at.
  const [languageContext, setLanguageContext] = useState(() => defaultUserLanguageContext());
  const [commandText, setCommandText] = useState("");
  const [commandFeedback, setCommandFeedback] = useState(null); // {ok: boolean, message: string} | null
  // GATE A.7.2A — REAL IMAGE INPUT. `heroImage` is the A.7.1 drawable shape
  // ({source, width, height}) or null, held as its own sibling piece of
  // ephemeral state — never folded into `composition`, which already
  // declares the `heroImage` ROLE (A.7.1) and needs no change at all when a
  // real photo is chosen. Never persisted, never an asset row, never
  // Supabase — the same "ephemeral, discarded on close" contract this whole
  // component already documents for `content`/`composition`.
  const [heroImage, setHeroImage] = useState(null);
  const [imageError, setImageError] = useState(null);

  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const startRef = useRef(0);
  // GATE A.7.2A — bumped on every new file selection AND on every family
  // switch. An in-flight createImageBitmap() decode captures the value at
  // its own start and checks it again once decoded; a mismatch means a
  // NEWER selection (or a family switch away from Statement/Hero) already
  // superseded this attempt, so its bitmap is closed and discarded rather
  // than ever reaching setHeroImage() — the exact guard against the
  // "image A starts decoding, user picks image B, A resolves after B"
  // race, and against a stale decode from a family the user has since left.
  const heroImageGenerationRef = useRef(0);
  // Bumped every time the governed inputs change or this component
  // unmounts — an in-flight async continuation (the font-readiness await
  // in onPreviewMotion) or a scheduled rAF tick checks this before acting,
  // so neither can ever draw with a stale template/payload/spec or fire
  // after unmount.
  const sessionRef = useRef(0);

  // GATE — ATOMIC FAMILY SWITCH (see this file's own header). Selecting a
  // different family resets the ephemeral content/composition/preset/
  // selection — never persisted, so there is nothing to save/discard, just
  // a fresh local draft for the newly selected template's own declared
  // slots and motion presets. Done here, during render, comparing against
  // the family this component last reset FOR — never inside a
  // useEffect(() => {...}, [familyKey]), which would let one render commit
  // with the new template but the old composition/content first.
  const [resetForFamilyKey, setResetForFamilyKey] = useState(familyKey);
  if (familyKey !== resetForFamilyKey) {
    setResetForFamilyKey(familyKey);
    setContent(emptyContentFor(template));
    setComposition(defaultCompositionFor(template, GOLDEN_FORMAT));
    setPreset(template.motion.supportedPresets[0]);
    setSelectedElementId(null);
    setError(null);
    setCommandText("");
    setCommandFeedback(null);
    // GATE A.7.2A — a hero image belongs to Statement/Hero specifically
    // (the only family declaring an imageSlot at all — see templates.js).
    // Leaving that family must not leave an orphaned bitmap open (the
    // cleanup effect below closes whatever heroImage held the moment it
    // flips to null), and bumping the generation here means a decode still
    // in flight from the family just left can never land afterward.
    heroImageGenerationRef.current += 1;
    setHeroImage(null);
    setImageError(null);
  }

  // GATE A.7.2A — the ONE place `drawables` is built, from the SAME
  // `heroImage` state both the live viewport render (below) and Export PNG
  // consume — never two independently-constructed drawables objects, so
  // "the export contains whatever the viewport is currently showing" is
  // true by construction, not by keeping two things in sync by hand.
  const drawables = heroImage ? { heroImage } : {};

  // GATE — EXPORT-ERROR LIFECYCLE (see this file's own header). A stale
  // Export PNG failure must not survive a corrective change made through
  // any OTHER control (family switch, editing a text field, an alignment
  // click, a creative command) — every one of those changes `familyKey`,
  // `content`, or `composition`, so clearing here covers all of them
  // uniformly. Export PNG itself still independently clears/recomputes
  // this on every attempt (onExportPng, below), unchanged.
  useEffect(() => {
    setExportError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyKey, content, composition]);

  // GATE A.7.2A — RESOURCE LIFECYCLE. The exact same "effect owns an
  // external resource, its cleanup releases it" idiom this file already
  // uses for `rafRef` below: this cleanup fires whenever `heroImage`
  // changes (closing the PREVIOUS bitmap right before the new one takes
  // over — image A is released the instant image B becomes current) AND on
  // unmount (closing whatever is current). A failed decode never calls
  // setHeroImage() at all (see onHeroImageFile below), so it never enters
  // this effect's lifecycle in the first place — there is nothing to close.
  useEffect(() => {
    return () => { heroImage?.source?.close?.(); };
  }, [heroImage]);

  // Draws the SETTLED STATIC composition — the default view, no
  // animation, isPlaying=false, no autoplay — via the composition-aware
  // renderCompositionToCanvas() (Gate A.6.1/A.6.4), every time the
  // governed inputs change. The returned cleanup function is this component's ONE lifecycle
  // guarantee: it fires on family/preset/content change AND on unmount,
  // and it is the only place a running loop is ever cancelled — so
  // "switching family/preset/content cannot leave an old animation
  // running" and "cleanup on unmount" are the SAME mechanism, not two.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const payload = buildEphemeralPayload(template, content);
    const payloadValidation = validateCreativePayload({ payload, template, format: GOLDEN_FORMAT });
    const compositionValidation = validateCreativeComposition({ composition, template });
    if (!payloadValidation.valid) {
      setError(payloadValidation.error);
      setSelectionBounds([]);
      // An invalid composition/payload state has no valid selection to
      // speak of — clearing only the visible boxes while leaving
      // selectedElementId set would leave the alignment picker rendered
      // and able to mutate composition with no canvas feedback confirming
      // anything. Treat invalid state as "nothing is selected."
      setSelectedElementId(null);
    } else if (!compositionValidation.valid) {
      setError(compositionValidation.error);
      setSelectionBounds([]);
      setSelectedElementId(null);
    } else {
      setError(null);
      // GATE A.7.2A — `drawables` (built above from `heroImage` state) is
      // the ONLY new argument here; render.js's own contract (established
      // A.7.1) is otherwise unchanged — a role with no matching drawable
      // (drawables: {} when no image has been chosen) draws nothing, same
      // as before this gate existed.
      renderCompositionToCanvas({ canvas, template, payload, composition, drawables });
      const bounds = computeElementSelectionBounds({ canvas, template, content });
      setSelectionBounds(bounds);
      setSelectedElementId((current) => (current != null && bounds.some((b) => b.role === current) ? current : null));
    }

    return () => {
      sessionRef.current += 1;
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        setIsPlaying(false);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyKey, preset, content, composition, heroImage]);

  const onPreviewMotion = useCallback(async () => {
    const session = ++sessionRef.current;
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    setIsPlaying(false);
    setError(null);

    const payload = buildEphemeralPayload(template, content);
    const payloadValidation = validateCreativePayload({ payload, template, format: GOLDEN_FORMAT });
    if (!payloadValidation.valid) { setError(payloadValidation.error); return; }

    // GATE A.6.5 — the SAME composition the live static render already
    // uses (captured here, once, alongside payload — never re-read from
    // state mid-animation, exactly like payload itself never is), so the
    // selected element's alignment survives into the motion pipeline
    // unchanged.
    const compositionValidation = validateCreativeComposition({ composition, template });
    if (!compositionValidation.valid) { setError(compositionValidation.error); return; }

    const motionSpec = { preset, durationMs: DEFAULT_DURATION_MS, fps: DEFAULT_FPS, loop: false };
    const motionValidation = validateMotionSpecification({ motionSpec, template });
    if (!motionValidation.valid) { setError(motionValidation.error); return; }

    await ensureCreativeFontsReady();
    if (session !== sessionRef.current) return; // superseded/unmounted while awaiting fonts

    const canvas = canvasRef.current;
    if (!canvas) return;

    // GATE A.7.2A — DELIBERATELY NOT PASSING `drawables` HERE. Image motion
    // is explicitly out of scope for this gate, and render.js's own
    // renderCompositionMotionFrameToCanvas() contract is NOT being expanded
    // to accept one (see design/render.js's own A.7.1 header on why image
    // support was scoped to the static renderer only). This means a chosen
    // hero image does not appear WHILE "Preview motion" is animating, and
    // the canvas shows the last-drawn motion frame (text only) until some
    // other input change re-runs the static draw effect above — a known,
    // accepted limitation of this gate, not an oversight (see this file's
    // own A.7.2A implementation report).
    //
    // reduced motion: use the SAME deterministic renderer/timing math to
    // reach the settled frame, never a separate hand-drawn "final state" —
    // totalFrames <= 1 makes design/timing.js's own resolveProgress()
    // (inside renderCompositionMotionFrameToCanvas()) resolve to progress 1
    // unconditionally, exactly the same settled composition a completed
    // animation would end on. isPlaying never becomes true here.
    const reducedMotion = typeof window !== "undefined" && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      renderCompositionMotionFrameToCanvas({ canvas, template, payload, composition, motionSpec, frameIndex: 0, totalFrames: 1 });
      return;
    }

    const totalFrames = deriveTotalFrames(motionSpec.durationMs, motionSpec.fps);
    startRef.current = performance.now();
    setIsPlaying(true);

    const tick = () => {
      if (session !== sessionRef.current) return; // cancelled/superseded — never draws stale state
      const elapsed = performance.now() - startRef.current;
      const frameIndex = frameIndexForElapsed(elapsed, motionSpec.durationMs, totalFrames, motionSpec.loop);
      renderCompositionMotionFrameToCanvas({ canvas, template, payload, composition, motionSpec, frameIndex, totalFrames });

      const finished = !motionSpec.loop && elapsed >= motionSpec.durationMs;
      if (finished) { rafRef.current = null; setIsPlaying(false); return; }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [template, content, preset, composition]);

  /** GATE A.5.6, updated Gate A.6.6 — Export PNG. Same validated payload/
   *  template/composition the live preview already uses, drawn via the
   *  composition-aware STATIC renderer (renderCompositionToCanvas() — never
   *  renderCompositionMotionFrameToCanvas(): the export is always the
   *  settled composition, not a motion frame) onto a second, offscreen
   *  canvas, then encoded/downloaded via the existing canvasToPngBlob()/
   *  downloadBlob() helpers. No canvas is ever created if validation fails
   *  first — including composition validation, added by this gate. */
  const onExportPng = useCallback(async () => {
    setExportError(null);

    const payload = buildEphemeralPayload(template, content);
    const validation = validateCreativePayload({ payload, template, format: GOLDEN_FORMAT });
    if (!validation.valid) { setExportError(validation.error); return; }

    const compositionValidation = validateCreativeComposition({ composition, template });
    if (!compositionValidation.valid) { setExportError(compositionValidation.error); return; }

    const languageValidation = validateUserLanguageContext(languageContext);
    if (!languageValidation.valid) { setExportError(languageValidation.error); return; }

    setExportBusy(true);
    try {
      await ensureCreativeFontsReady();

      const canvas = document.createElement("canvas");
      canvas.width = PREVIEW_DIMENSIONS.width;
      canvas.height = PREVIEW_DIMENSIONS.height;

      // GATE A.7.2A — EXPORT/VIEWPORT PARITY. The SAME `drawables` the live
      // viewport render effect above just used, never a second/independent
      // one — see this file's own header on why `drawables` is built
      // exactly once from `heroImage` state. A user can never see a photo
      // in the viewport and then receive a PNG without it: whatever
      // `renderCompositionToCanvas()` drew on screen is exactly what this
      // call draws onto the export canvas, same composition, same payload,
      // same drawables, only the destination canvas differs.
      renderCompositionToCanvas({ canvas, template, payload, composition, drawables });

      const blob = await canvasToPngBlob(canvas);
      if (!blob) { setExportError("PNG rendering failed."); return; }

      const slug = String(content.headline ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || template.label.toLowerCase().replace(/[^a-z0-9]+/gi, "-");
      downloadBlob(blob, `${slug}.png`);
    } finally {
      setExportBusy(false);
    }
  }, [template, content, composition, languageContext, drawables]);

  /** GATE A.7.1 — updates exactly one of the three independent language
   *  settings, immutably, never touching the other two (see design/
   *  language.js's own header on why they must never be coupled). */
  const setLanguage = (field) => (e) => setLanguageContext((c) => ({ ...c, [field]: e.target.value }));

  const setSlot = (slotId) => (e) => setContent((c) => ({ ...c, [slotId]: e.target.value }));

  /** GATE A.7.2A — REAL IMAGE INPUT. File -> createImageBitmap() -> ready
   *  drawable -> setHeroImage(), never Image()/object URLs/FileReader/a
   *  remote URL, and never a File/Blob passed to render.js (see
   *  design/render.js's own A.7.1 drawable contract — this function is the
   *  ONLY place in this whole feature that touches File/createImageBitmap
   *  at all). `composition` is never touched here — the `heroImage` ROLE
   *  already exists in it (A.7.1); only the sibling `heroImage` DRAWABLE
   *  state this function sets is new.
   *
   *  RACE SAFETY: `generation` is captured once, at the start, from
   *  heroImageGenerationRef — bumped by every call to this function AND by
   *  the family-switch reset above. If that ref's value has moved on by
   *  the time decode finishes (a newer file was chosen, or the user left
   *  Statement/Hero, while this decode was in flight), the freshly-decoded
   *  bitmap is closed immediately and DISCARDED — it never reaches
   *  setHeroImage(), so a slow-resolving older selection can never
   *  overwrite a newer one. */
  const onHeroImageFile = async (e) => {
    const file = e.target.files?.[0] ?? null;
    // Cleared immediately so selecting the SAME file again still fires
    // onChange, and so this input never retains a reference to a File this
    // component no longer cares about.
    e.target.value = "";
    if (!file) return;

    const generation = ++heroImageGenerationRef.current;
    setImageError(null);

    if (!HERO_IMAGE_ALLOWED_TYPES.includes(file.type)) {
      setImageError(`"${file.type || "that file type"}" is not supported — choose a JPEG, PNG, or WebP image.`);
      return;
    }

    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      if (heroImageGenerationRef.current === generation) {
        setImageError("That image could not be opened — it may be corrupted or in an unsupported format.");
      }
      return;
    }

    if (heroImageGenerationRef.current !== generation) {
      // Superseded while decoding — never retained, never shown.
      bitmap.close();
      return;
    }

    setHeroImage({ source: bitmap, width: bitmap.width, height: bitmap.height });
  };

  /** GATE A.6.4 — the ONE controlled property. Updates ONLY the selected
   *  element's own alignment, immutably, inside the SAME composition object
   *  that already drives the live static render (A.6.2) — never a second,
   *  preview-only copy. The live-preview effect's own [.., composition]
   *  dependency picks this up and re-validates/re-renders exactly like any
   *  other content change. */
  const selectedElement = composition.elements.find((el) => el.role === selectedElementId) ?? null;
  const setSelectedAlignment = (alignment) => {
    if (!selectedElementId) return;
    setComposition((c) => ({
      ...c,
      elements: c.elements.map((el) => (el.role === selectedElementId ? { ...el, properties: { ...el.properties, alignment } } : el)),
    }));
  };

  /** GATE A.7.5 — the natural-language path to the SAME change
   *  setSelectedAlignment() above makes by button click. interpretCreativeCommand()
   *  resolves WHAT should change (using the current selection as context —
   *  A.7.6, no element id ever typed); applyCreativeOperation() then makes
   *  that change to the SAME composition state the live preview and Export
   *  PNG already use. A refusal (unrecognised instruction, non-English
   *  input, a role this template does not declare) never touches
   *  composition at all — only a plain, honest reason is shown. */
  const onSubmitCommand = (e) => {
    e.preventDefault();
    const interpreted = interpretCreativeCommand({ message: commandText, template, selectedElementId });
    if (!interpreted.understood) {
      setCommandFeedback({ ok: false, message: interpreted.reason });
      return;
    }
    const result = applyCreativeOperation({ operation: interpreted.operation, composition });
    if (!result.applied) {
      setCommandFeedback({ ok: false, message: result.error });
      return;
    }
    setComposition(result.composition);
    setCommandFeedback({ ok: true, message: `Done — ${interpreted.operation.targetRole} is now ${interpreted.operation.alignment}-aligned.` });
    setCommandText("");
  };

  return (
    <Panel accent={TEAL}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 12, color: IVORY }}>{template.label} — Motion Preview</div>
        <DemoTag label="Ephemeral — nothing here is saved as a draft, but Export PNG downloads it directly" />
      </div>

      <Label>Family</Label>
      <select value={familyKey} onChange={(e) => setFamilyKey(e.target.value)} aria-label="Creative family"
        style={{ ...inputStyle, marginBottom: 14 }}>
        {CREATIVE_TEMPLATE_LIST.map((t) => <option key={t.family} value={t.family}>{t.label}</option>)}
      </select>

      {/* GATE A.7.1 — three independent language settings. Not yet wired to
          any real interface translation, AI conversation, or creative-text
          generation — see this file's own header and design/language.js. */}
      <Label>Language</Label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8, marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: UI, fontSize: 10.5, color: MUTED, marginBottom: 4 }}>Interface</div>
          <select value={languageContext.interfaceLanguage} onChange={setLanguage(LANGUAGE_CONTEXT_FIELD.INTERFACE)}
            aria-label="Interface language" style={inputStyle}>
            {CREATIVE_LANGUAGE_LIST.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontFamily: UI, fontSize: 10.5, color: MUTED, marginBottom: 4 }}>Talk to AI in</div>
          <select value={languageContext.aiInteractionLanguage} onChange={setLanguage(LANGUAGE_CONTEXT_FIELD.AI_INTERACTION)}
            aria-label="AI interaction language" style={inputStyle}>
            {CREATIVE_LANGUAGE_LIST.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontFamily: UI, fontSize: 10.5, color: MUTED, marginBottom: 4 }}>Graphic text in</div>
          <select value={languageContext.creativeOutputLanguage} onChange={setLanguage(LANGUAGE_CONTEXT_FIELD.CREATIVE_OUTPUT)}
            aria-label="Creative output language" style={inputStyle}>
            {CREATIVE_LANGUAGE_LIST.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
        </div>
      </div>

      {template.textSlots.map((slot) => (
        <div key={slot.id} style={{ marginBottom: 9 }}>
          <div style={{ fontFamily: UI, fontSize: 10.5, color: MUTED, marginBottom: 4 }}>{slot.label}</div>
          <input value={content[slot.id] ?? ""} onChange={setSlot(slot.id)} aria-label={slot.label} style={inputStyle} />
        </div>
      ))}

      {/* GATE A.7.2A — REAL IMAGE INPUT. The smallest entry point: a native
          file chooser per declared image slot (today, exactly one:
          heroImage, on Statement/Hero only — see templates.js). No
          drag/drop, no gallery, no thumbnail — the canvas itself, redrawn
          by the live-preview effect above the moment heroImage state
          changes, IS the preview. */}
      {template.imageSlots?.map((slot) => (
        <div key={slot.id} style={{ marginBottom: 9 }}>
          <div style={{ fontFamily: UI, fontSize: 10.5, color: MUTED, marginBottom: 4 }}>{slot.label}</div>
          <input type="file" accept={HERO_IMAGE_ALLOWED_TYPES.join(",")} onChange={onHeroImageFile}
            aria-label={slot.label} style={{ fontFamily: UI, fontSize: 11.5, color: IVORY, display: "block" }} />
        </div>
      ))}

      <div style={{ marginBottom: 14, display: "flex", justifyContent: "center" }}>
        <div style={{ position: "relative", width: "100%", maxWidth: 320, aspectRatio: `${PREVIEW_DIMENSIONS.width} / ${PREVIEW_DIMENSIONS.height}` }}>
          <canvas ref={canvasRef} width={PREVIEW_DIMENSIONS.width} height={PREVIEW_DIMENSIONS.height}
            style={{ width: "100%", height: "100%", display: "block", background: BLACK, border: `1px solid ${BORDER}` }} />
          {selectionBounds.map((b) => (
            <button key={b.role} type="button" onClick={() => setSelectedElementId(b.role)} aria-label={`Select ${b.role} element`}
              style={{
                position: "absolute", boxSizing: "border-box",
                left: `${(b.x / PREVIEW_DIMENSIONS.width) * 100}%`, top: `${(b.y / PREVIEW_DIMENSIONS.height) * 100}%`,
                width: `${(b.width / PREVIEW_DIMENSIONS.width) * 100}%`, height: `${(b.height / PREVIEW_DIMENSIONS.height) * 100}%`,
                cursor: "pointer", background: "transparent", padding: 0,
                // IVORY, not TEAL: this family's own background token IS
                // teal (COLOUR_TOKEN.primary, render.js), so a teal
                // selection border is invisible against it — ivory is not
                // used as a background token by any of the 3 families.
                border: selectedElementId === b.role ? `2px solid ${IVORY}` : "1px solid transparent",
              }} />
          ))}
        </div>
      </div>

      {selectedElement && (
        <div style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ fontFamily: UI, fontSize: 10.5, color: MUTED }}>Alignment ({selectedElement.role})</div>
          {TEXT_ALIGNMENT_LIST.map((a) => (
            <button key={a} type="button" onClick={() => setSelectedAlignment(a)}
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase",
                padding: "7px 14px", border: `1px solid ${BORDER}`, cursor: "pointer",
                background: selectedElement.properties.alignment === a ? TEAL : "transparent",
                color: selectedElement.properties.alignment === a ? BLACK : IVORY }}>
              {ALIGNMENT_LABEL[a] ?? a}
            </button>
          ))}
        </div>
      )}

      {/* GATE A.7.5 — the same alignment change above, reachable by typing
          instead of clicking. Understood in English only right now (see
          design/creativeCommand.js's INTERPRETED_LANGUAGES). */}
      <form onSubmit={onSubmitCommand} style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: UI, fontSize: 10.5, color: MUTED, marginBottom: 4 }}>Tell the studio what to change</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={commandText} onChange={(e) => setCommandText(e.target.value)}
            placeholder='e.g. "center the headline"' aria-label="Creative command" style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
          <button type="submit"
            style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase",
              padding: "0 16px", border: `1px solid ${BORDER}`, background: "transparent", color: IVORY, cursor: "pointer" }}>
            Apply
          </button>
        </div>
        {commandFeedback && (
          <div style={{ fontFamily: UI, fontSize: 11.5, marginTop: 6, color: commandFeedback.ok ? TEAL : PINK }}>
            {commandFeedback.message}
          </div>
        )}
      </form>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        {template.motion.supportedPresets.length > 1 && (
          <select value={preset} onChange={(e) => setPreset(e.target.value)} aria-label="Motion preset" style={{ ...inputStyle, width: "auto", marginBottom: 0 }}>
            {template.motion.supportedPresets.map((p) => <option key={p} value={p}>{PRESET_LABEL[p] ?? p}</option>)}
          </select>
        )}
        <button onClick={onPreviewMotion}
          style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase",
            padding: "11px 18px", border: "none", background: TEAL, color: BLACK, cursor: "pointer" }}>
          {isPlaying ? "Previewing…" : "Preview motion"}
        </button>
        <button onClick={onExportPng} disabled={exportBusy}
          style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase",
            padding: "11px 18px", background: "transparent", border: `1px solid ${BORDER}`, color: IVORY,
            cursor: exportBusy ? "not-allowed" : "pointer" }}>
          {exportBusy ? "Exporting…" : "Export PNG"}
        </button>
      </div>

      {error && <div style={{ fontFamily: UI, fontSize: 12, color: PINK, marginTop: 10 }}>{friendlyError(error)}</div>}
      {imageError && <div style={{ fontFamily: UI, fontSize: 12, color: PINK, marginTop: 10 }}>{friendlyError(imageError)}</div>}
      {exportError && <div style={{ fontFamily: UI, fontSize: 12, color: PINK, marginTop: 10 }}>{friendlyError(exportError)}</div>}
    </Panel>
  );
}

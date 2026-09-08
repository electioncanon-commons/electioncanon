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
// ============================================================

import { useState, useRef, useEffect, useCallback } from "react";
import { CREATIVE_TEMPLATES, CREATIVE_FAMILY, CREATIVE_TEMPLATE_LIST, CREATIVE_FORMAT } from "../../domains/election/design/templates.js";
import { buildStudioCreativePayload, validateCreativePayload } from "../../domains/election/design/creative.js";
import { renderCompositionToCanvas, renderCompositionMotionFrameToCanvas, computeElementSelectionBounds, canvasToPngBlob } from "../../domains/election/design/render.js";
import { defaultCompositionFor, validateCreativeComposition, TEXT_ALIGNMENT_LIST } from "../../domains/election/design/composition.js";
import { validateMotionSpecification, MOTION_DURATION_MS, MOTION_FPS_OPTIONS } from "../../domains/election/design/motion.js";
import { deriveTotalFrames, frameIndexForElapsed } from "../../domains/election/design/timing.js";
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

  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const startRef = useRef(0);
  // Bumped every time the governed inputs change or this component
  // unmounts — an in-flight async continuation (the font-readiness await
  // in onPreviewMotion) or a scheduled rAF tick checks this before acting,
  // so neither can ever draw with a stale template/payload/spec or fire
  // after unmount.
  const sessionRef = useRef(0);

  // Selecting a different family resets the ephemeral content and preset
  // — never persisted, so there is nothing to save/discard, just a fresh
  // local draft for the newly selected template's own declared slots and
  // its own declared motion presets.
  useEffect(() => {
    setContent(emptyContentFor(template));
    setComposition(defaultCompositionFor(template, GOLDEN_FORMAT));
    setPreset(template.motion.supportedPresets[0]);
    setSelectedElementId(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyKey]);

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
    } else if (!compositionValidation.valid) {
      setError(compositionValidation.error);
      setSelectionBounds([]);
    } else {
      setError(null);
      renderCompositionToCanvas({ canvas, template, payload, composition });
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
  }, [familyKey, preset, content, composition]);

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

    setExportBusy(true);
    try {
      await ensureCreativeFontsReady();

      const canvas = document.createElement("canvas");
      canvas.width = PREVIEW_DIMENSIONS.width;
      canvas.height = PREVIEW_DIMENSIONS.height;

      renderCompositionToCanvas({ canvas, template, payload, composition });

      const blob = await canvasToPngBlob(canvas);
      if (!blob) { setExportError("PNG rendering failed."); return; }

      const slug = String(content.headline ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || template.label.toLowerCase().replace(/[^a-z0-9]+/gi, "-");
      downloadBlob(blob, `${slug}.png`);
    } finally {
      setExportBusy(false);
    }
  }, [template, content, composition]);

  const setSlot = (slotId) => (e) => setContent((c) => ({ ...c, [slotId]: e.target.value }));

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

      {template.textSlots.map((slot) => (
        <div key={slot.id} style={{ marginBottom: 9 }}>
          <div style={{ fontFamily: UI, fontSize: 10.5, color: MUTED, marginBottom: 4 }}>{slot.label}</div>
          <input value={content[slot.id] ?? ""} onChange={setSlot(slot.id)} aria-label={slot.label} style={inputStyle} />
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
      {exportError && <div style={{ fontFamily: UI, fontSize: 12, color: PINK, marginTop: 10 }}>{friendlyError(exportError)}</div>}
    </Panel>
  );
}

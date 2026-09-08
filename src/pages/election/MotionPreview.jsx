// ============================================================
// ELECTION FORGE — CAMPAIGN STUDIO: MOTION PREVIEW  (Gate A.5.5.3)
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
//     -> buildStudioCreativePayload()      (design/creative.js, unchanged)
//     -> validateCreativePayload()         (design/creative.js, unchanged)
//   local preset choice + fixed duration/fps/loop
//     -> validateMotionSpecification()     (design/motion.js, unchanged)
//     -> renderMotionFrameToCanvas()       (design/render.js, unchanged)
//
// buildStudioCreativePayload() was never legacy-specific — it already
// reads ANY template's own declared `textSlots` generically (see that
// function's own header) — so handing it a locally-shaped, in-memory
// `{content: {text: ...}}` object (never an `asset`, never saved) is not
// a new/parallel payload shape, just the same builder fed ephemeral
// input instead of a persisted one.
//
// NO MOTION MATH LIVES HERE. This file only ever calls
// design/timing.js's deriveTotalFrames()/frameIndexForElapsed() and
// design/render.js's renderMotionFrameToCanvas() — it never computes an
// easing value or a progress fraction itself. `performance.now()` is the
// ONLY wall-clock reference in this whole feature, and it stays here, at
// the page layer — renderMotionFrameToCanvas() never receives it.
//
// ARTIFACT-READINESS (see the A.5.5 architecture review). This component
// knows only {canvas, template, payload, motionSpec, frameIndex,
// totalFrames} — it has zero knowledge of what renderMotionFrameToCanvas()
// draws inside that call. A future artifact-aware renderer signature
// would need no change here beyond passing one more prop through.
// ============================================================

import { useState, useRef, useEffect, useCallback } from "react";
import { CREATIVE_TEMPLATES, CREATIVE_FAMILY, CREATIVE_TEMPLATE_LIST, CREATIVE_FORMAT } from "../../domains/election/design/templates.js";
import { buildStudioCreativePayload, validateCreativePayload } from "../../domains/election/design/creative.js";
import { renderTemplateToCanvas, renderMotionFrameToCanvas } from "../../domains/election/design/render.js";
import { validateMotionSpecification, MOTION_DURATION_MS, MOTION_FPS_OPTIONS } from "../../domains/election/design/motion.js";
import { deriveTotalFrames, frameIndexForElapsed } from "../../domains/election/design/timing.js";
import { Label, Panel, DemoTag, friendlyError, ensureCreativeFontsReady, UI, IVORY, MUTED, TEAL, PINK, BORDER, BLACK, inputStyle } from "./shared.jsx";

// A fixed, non-user-selectable preview format — this ephemeral surface
// does not expose a format picker (not part of the approved UX). 1080x1080
// mirrors the same canonical "square" dimensions design/creative.js's own
// FORMAT_DIMENSIONS and communications/export.js's own EXPORT_FORMATS
// already use — deliberately duplicated here rather than imported
// cross-feature, the same small-table precedent already established
// elsewhere in this codebase.
const PREVIEW_DIMENSIONS = Object.freeze({ width: 1080, height: 1080 });

// Fixed, code-chosen motion defaults — not exposed to the user at all
// (the approved UX asks only for a preset choice, never duration/fps/loop
// controls). Clamped/validated against design/motion.js's own governed
// bounds/enum rather than trusted as disconnected literals, so a future
// change to those bounds can never silently leave this preview
// requesting an invalid specification.
const DEFAULT_DURATION_MS = Math.min(Math.max(1800, MOTION_DURATION_MS.MIN), MOTION_DURATION_MS.MAX);
const DEFAULT_FPS = MOTION_FPS_OPTIONS.includes(30) ? 30 : MOTION_FPS_OPTIONS[0];

const PRESET_LABEL = Object.freeze({ fade: "Fade", slideUp: "Slide up", staggerLines: "Staggered reveal" });

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
  const [preset, setPreset] = useState(template.motion.supportedPresets[0]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState(null);

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
    setPreset(template.motion.supportedPresets[0]);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyKey]);

  // Draws the SETTLED STATIC composition — the default view, no
  // animation, isPlaying=false, no autoplay — via the unchanged
  // renderTemplateToCanvas(), every time the governed inputs change.
  // The returned cleanup function is this component's ONE lifecycle
  // guarantee: it fires on family/preset/content change AND on unmount,
  // and it is the only place a running loop is ever cancelled — so
  // "switching family/preset/content cannot leave an old animation
  // running" and "cleanup on unmount" are the SAME mechanism, not two.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const payload = buildEphemeralPayload(template, content);
    const validation = validateCreativePayload({ payload, template, format: CREATIVE_FORMAT.SQUARE });
    if (!validation.valid) {
      setError(validation.error);
    } else {
      setError(null);
      renderTemplateToCanvas({ canvas, template, payload });
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
  }, [familyKey, preset, content]);

  const onPreviewMotion = useCallback(async () => {
    const session = ++sessionRef.current;
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    setIsPlaying(false);
    setError(null);

    const payload = buildEphemeralPayload(template, content);
    const payloadValidation = validateCreativePayload({ payload, template, format: CREATIVE_FORMAT.SQUARE });
    if (!payloadValidation.valid) { setError(payloadValidation.error); return; }

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
    // (inside renderMotionFrameToCanvas()) resolve to progress 1
    // unconditionally, exactly the same settled composition a completed
    // animation would end on. isPlaying never becomes true here.
    const reducedMotion = typeof window !== "undefined" && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      renderMotionFrameToCanvas({ canvas, template, payload, motionSpec, frameIndex: 0, totalFrames: 1 });
      return;
    }

    const totalFrames = deriveTotalFrames(motionSpec.durationMs, motionSpec.fps);
    startRef.current = performance.now();
    setIsPlaying(true);

    const tick = () => {
      if (session !== sessionRef.current) return; // cancelled/superseded — never draws stale state
      const elapsed = performance.now() - startRef.current;
      const frameIndex = frameIndexForElapsed(elapsed, motionSpec.durationMs, totalFrames, motionSpec.loop);
      renderMotionFrameToCanvas({ canvas, template, payload, motionSpec, frameIndex, totalFrames });

      const finished = !motionSpec.loop && elapsed >= motionSpec.durationMs;
      if (finished) { rafRef.current = null; setIsPlaying(false); return; }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [template, content, preset]);

  const setSlot = (slotId) => (e) => setContent((c) => ({ ...c, [slotId]: e.target.value }));

  return (
    <Panel accent={TEAL}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 12, color: IVORY }}>{template.label} — Motion Preview</div>
        <DemoTag label="Ephemeral preview — not saved, no export" />
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
        <canvas ref={canvasRef} width={PREVIEW_DIMENSIONS.width} height={PREVIEW_DIMENSIONS.height}
          style={{ width: "100%", maxWidth: 320, aspectRatio: `${PREVIEW_DIMENSIONS.width} / ${PREVIEW_DIMENSIONS.height}`, background: BLACK, border: `1px solid ${BORDER}` }} />
      </div>

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
      </div>

      {error && <div style={{ fontFamily: UI, fontSize: 12, color: PINK, marginTop: 10 }}>{friendlyError(error)}</div>}
    </Panel>
  );
}

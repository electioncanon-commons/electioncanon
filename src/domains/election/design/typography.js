// ============================================================
// FORGE ELECTION — CREATIVE TYPOGRAPHY CONTRACT  (Gate A.5.4 foundation)
//
// os/forge.js's FONT tokens (FONT.display/FONT.ui) are CSS custom-property
// strings — e.g. "var(--forge-display-font, 'Poppins', system-ui,
// sans-serif)" — meant for the DOM/CSS cascade. A <canvas> 2D context's
// own `font` setter does NOT resolve CSS custom properties; it needs a
// literal font shorthand ("900 64px Poppins, sans-serif"). This file is
// that literal, canvas-specific expression of the SAME brand decision
// forge-brand.css already documents ("Poppins is the single Forge face,
// Black (900) for headlines") — not a second, competing typography
// source of truth, just the one vocabulary canvas actually accepts.
//
// No DOM access here (this file lives under src/domains/election/, a
// structurally-enforced DOM-free boundary — see design/render.js's own
// header). Font *loading* (document.fonts.load/.ready) is therefore a
// page-layer concern — see pages/election/shared.jsx's
// ensureCreativeFontsReady().
// ============================================================

export const CREATIVE_FONT_FAMILY = "'Poppins', sans-serif";
export const CREATIVE_HEADLINE_WEIGHT = 900;
export const CREATIVE_BODY_WEIGHT = 400;

// The exact face+weight strings a page-layer font-loader should request
// with document.fonts.load(...) before any creative render — kept here so
// there is exactly one place that names "what Poppins weights this
// renderer actually uses," never duplicated at the call site.
export const CREATIVE_FONT_LOAD_SPECS = Object.freeze([
  `${CREATIVE_HEADLINE_WEIGHT} 64px ${CREATIVE_FONT_FAMILY}`,
  `${CREATIVE_BODY_WEIGHT} 64px ${CREATIVE_FONT_FAMILY}`,
]);

/** Builds a canvas `ctx.font` shorthand string for one of this renderer's
 *  two typographic roles. "headline" always requests Poppins Black (900)
 *  per this gate's typography requirement; every other role is Poppins at
 *  regular weight. Never transforms the TEXT itself (no case conversion —
 *  sentence case is an authoring convention, not something this function
 *  enforces or could enforce). */
export function creativeFont({ role, sizePx }) {
  const weight = role === "headline" ? CREATIVE_HEADLINE_WEIGHT : CREATIVE_BODY_WEIGHT;
  return `${weight} ${Math.round(sizePx)}px ${CREATIVE_FONT_FAMILY}`;
}

export default { CREATIVE_FONT_FAMILY, CREATIVE_HEADLINE_WEIGHT, CREATIVE_BODY_WEIGHT, CREATIVE_FONT_LOAD_SPECS, creativeFont };

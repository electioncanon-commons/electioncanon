// ============================================================
// ELECTIONCANON — SHELL PRIMITIVES  (UX Redesign Slice 1)
//
// New shared chrome primitives for the authenticated product shell:
// Shell (page wrapper), PrimaryNav (responsive nav — compact bar on
// desktop/tablet, accessible drawer on mobile), ContextBar + ScopeBadge
// (the persistent "where am I / what's my scope" surface).
//
// Deliberately separate from shared.jsx rather than importing it, even
// though both read the same underlying tokens (T from os/forge.js,
// CLIP_PATHS from os/geometry.js) — shared.jsx's AppHeader imports
// PrimaryNav/ContextBar FROM this file, so this file must not import
// shared.jsx back (would create a cycle). This is the one deliberate,
// justified exception to "don't duplicate an import" in this codebase.
//
// SAME TOKENS, NO NEW HEX VALUES. Per docs/DESIGN_SYSTEM.md, the
// authenticated product UI is migrated incrementally, not re-skinned —
// every color/spacing value here is one already in use elsewhere in the
// product shell.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { T } from "../../os/forge.js";
import { CLIP_PATHS } from "../../os/geometry.js";
// Safe to import (no cycle): useTranslation.js only reaches LanguageContext.jsx
// and uiStrings.js, never back into shared.jsx — unlike shared.jsx itself,
// which this file must never import (see header above).
import { useTranslation } from "./useTranslation.js";

const { black: BLACK, ivory: IVORY, teal: TEAL, pink: PINK, border: BORDER, grey: MUTED } = T;
const UI = "var(--font-ui, 'Poppins', system-ui, sans-serif)";

/** The page-level wrapper Election.jsx's own `shell()` closure used to
 *  inline — extracted so it's reusable and has one definition. Behavior
 *  is unchanged: full-height near-black canvas, centered max-width column. */
export function Shell({ children }) {
  return (
    <div className="ec-brand" style={{ background: BLACK, color: IVORY, minHeight: "100vh",
      padding: "clamp(28px,5vw,60px)", fontFamily: UI }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>{children}</div>
    </div>
  );
}

/** Small pill for a role/scope label — reused by ContextBar today, and
 *  available to section files for the same "who/what scope" chip later. */
export function ScopeBadge({ label, tone = "primary" }) {
  if (!label) return null;
  const color = tone === "muted" ? MUTED : TEAL;
  return (
    <span style={{ fontFamily: UI, fontWeight: 700, fontSize: 10, letterSpacing: "0.1em",
      textTransform: "uppercase", color, border: `1px solid ${color}`,
      padding: "4px 10px", clipPath: CLIP_PATHS.buttonSm, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

/** Persistent "where am I / what's my scope" strip. Reads only data
 *  Election.jsx already computes (actor-kind label, membership role) — no
 *  new Supabase read. The deeper "your assigned ward/LGA" answer stays in
 *  HomeSection's own scoped resolution for now (that resolution is async
 *  and geography-aware; duplicating it here would be a second read path
 *  for the same fact, which this slice deliberately avoids). */
export function ContextBar({ actorKindLabel, membershipRole }) {
  if (!actorKindLabel && !membershipRole) return null;
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
      <ScopeBadge label={actorKindLabel} />
      {membershipRole && <ScopeBadge label={membershipRole} tone="muted" />}
    </div>
  );
}

/** Responsive primary navigation. `sections` is [{id,label}]. Desktop/
 *  tablet (>=768px, via CSS in electioncanon-shell.css) shows a
 *  single-row compact bar; mobile shows a hamburger trigger opening an
 *  accessible drawer (role="dialog", focus-trapped, Escape/backdrop to
 *  close, focus restored to the trigger on close). Active item is marked
 *  by both color AND an underline/left-bar — never color alone. */
export function PrimaryNav({ sections, activeId, onSelect }) {
  const { t } = useTranslation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef(null);
  const triggerRef = useRef(null);

  const close = useCallback(() => {
    setDrawerOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const firstItem = drawerRef.current?.querySelector("button");
    firstItem?.focus();

    const onKeyDown = (e) => {
      if (e.key === "Escape") { close(); return; }
      if (e.key !== "Tab" || !drawerRef.current) return;
      const focusable = drawerRef.current.querySelectorAll("button");
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen, close]);

  const select = (id) => {
    onSelect(id);
    setDrawerOpen(false);
  };

  return (
    <>
      <nav className="ec-nav-bar" aria-label={t("a11y.primaryNav")}>
        {sections.map((s) => {
          const active = s.id === activeId;
          return (
            <button key={s.id} type="button" onClick={() => select(s.id)}
              className="ec-nav-item" aria-current={active ? "page" : undefined}
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.08em",
                padding: "10px 16px", cursor: "pointer", border: "none",
                borderBottom: `2px solid ${active ? TEAL : "transparent"}`,
                background: "transparent", color: active ? IVORY : MUTED, whiteSpace: "nowrap" }}>
              {s.labelKey ? t(s.labelKey) : s.label}
            </button>
          );
        })}
      </nav>

      <button type="button" ref={triggerRef} className="ec-nav-trigger" onClick={() => setDrawerOpen(true)}
        aria-haspopup="dialog" aria-expanded={drawerOpen} aria-label={t("a11y.navMenuOpen")}
        style={{ background: "transparent", border: `1px solid ${BORDER}`, cursor: "pointer", padding: "10px 12px" }}>
        <span className="ec-nav-trigger-bar" style={{ background: IVORY }} />
        <span className="ec-nav-trigger-bar" style={{ background: IVORY }} />
        <span className="ec-nav-trigger-bar" style={{ background: IVORY }} />
      </button>

      {drawerOpen && (
        <div className="ec-nav-drawer-backdrop" onClick={close}>
          <div className="ec-nav-drawer" role="dialog" aria-modal="true" aria-label={t("a11y.navDialog")}
            ref={drawerRef} onClick={(e) => e.stopPropagation()}
            style={{ background: BLACK, borderLeft: `1px solid ${BORDER}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "16px 18px", borderBottom: `1px solid ${BORDER}` }}>
              <span style={{ fontFamily: UI, fontWeight: 700, fontSize: 11, letterSpacing: "0.14em",
                textTransform: "uppercase", color: MUTED }}>{t("nav.drawerHeading")}</span>
              <button type="button" onClick={close} aria-label={t("a11y.navMenuClose")}
                style={{ background: "transparent", border: "none", color: IVORY, fontSize: 20,
                  lineHeight: 1, cursor: "pointer", padding: 4 }}>×</button>
            </div>
            {sections.map((s) => {
              const active = s.id === activeId;
              return (
                <button key={s.id} type="button" onClick={() => select(s.id)}
                  aria-current={active ? "page" : undefined}
                  style={{ display: "block", width: "100%", textAlign: "left", fontFamily: UI,
                    fontWeight: 700, fontSize: 13, padding: "14px 18px", cursor: "pointer",
                    background: active ? "rgba(10,127,115,0.12)" : "transparent", border: "none",
                    borderLeft: `3px solid ${active ? TEAL : "transparent"}`,
                    borderBottom: `1px solid ${BORDER}`, color: active ? IVORY : MUTED }}>
                  {s.labelKey ? t(s.labelKey) : s.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

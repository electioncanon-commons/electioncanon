// ============================================================
// ELECTIONCANON — LANGUAGE SESSION  (multilingual Track A)
//
// ONE piece of state: which of the three languages (language.js) this
// browser session is currently talking to ElectionCanon in. Nothing else
// lives here — not campaign, not role, not scope, not Canon data. Reading
// LanguageContext tells you NOTHING about who the user is or what they
// can see; it only ever answers "what language are they asking in right
// now", exactly the separation Phase 4/9 require (language can never
// become a second source of truth, or a second authorization channel).
//
// PERSISTENCE — localStorage, keyed per browser (not per campaign, not
// synced to any server row). Switching language is therefore instant,
// never touches Supabase, and can never "leak" a selection across
// accounts sharing a machine in a way that matters: it only ever changes
// which language Ask ElectionCanon answers in, nothing about what data an
// account can reach.
//
// WHY A REACT CONTEXT, NOT A PROP THREADED THROUGH EVERY SECTION.
// AskAssistant.jsx's ContextualAsk is mounted independently inside six
// different section files (Organisation/Mobilize/EventsSection/
// ElectionDaySection/IntelligenceSection), none of which otherwise need to
// know a language exists. Prop-drilling `language` through all six would
// touch every one of those files' own signatures for a concern none of
// them actually own. A context mounted once at Election.jsx's root lets
// AppHeader (the selector) and AskAssistant.jsx (the consumer) both read
// the same value directly — the "smallest safe way to add language-aware
// generation" the instruction asks for, not a rewrite of six files.
// ============================================================

import { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react";
import { DEFAULT_LANGUAGE, isSupportedLanguageCode } from "./language.js";

const STORAGE_KEY = "electioncanon_language";

function readStored() {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return isSupportedLanguageCode(v) ? v : DEFAULT_LANGUAGE;
  } catch {
    // Storage can throw (private browsing, disabled storage) — never let a
    // language PREFERENCE take down the page. English is always safe.
    return DEFAULT_LANGUAGE;
  }
}

const LanguageSessionContext = createContext(null);

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(DEFAULT_LANGUAGE);
  const [hydrated, setHydrated] = useState(false);

  // Read storage only after mount — avoids a server/client text mismatch
  // and keeps this file free of any assumption about WHEN it mounts.
  useEffect(() => { setLanguageState(readStored()); setHydrated(true); }, []);

  const setLanguage = useCallback((code) => {
    if (!isSupportedLanguageCode(code)) return;
    setLanguageState(code);
    try { window.localStorage.setItem(STORAGE_KEY, code); } catch { /* best effort, same as readStored() */ }
  }, []);

  // ACCESSIBILITY (Phase 12) / HTML LANGUAGE METADATA. Only reflects the
  // actual selection — never claims a correctness the pack doesn't have.
  // Screen readers use this to choose pronunciation rules for the page.
  useEffect(() => {
    try { document.documentElement.lang = language; } catch { /* non-DOM test env */ }
  }, [language]);

  const value = useMemo(() => ({ language, setLanguage, hydrated }), [language, setLanguage, hydrated]);
  return <LanguageSessionContext.Provider value={value}>{children}</LanguageSessionContext.Provider>;
}

/** Returns `{ language, setLanguage, hydrated }`. Safe to call from any
 *  component mounted under <LanguageProvider> — AppHeader (the selector)
 *  and AskAssistant.jsx (the consumer) both call this directly rather than
 *  receiving language as a prop. Falls back to the default language (never
 *  throws) if called outside a provider, so a page that doesn't mount one
 *  degrades to English rather than crashing.
 */
export function useLanguageSession() {
  const ctx = useContext(LanguageSessionContext);
  return ctx ?? { language: DEFAULT_LANGUAGE, setLanguage: () => {}, hydrated: true };
}

export default { LanguageProvider, useLanguageSession };

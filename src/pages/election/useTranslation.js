// ============================================================
// ELECTIONCANON — useTranslation()  (Six-Language UI Pass, Phase 2)
//
// The smallest clean bridge between the EXISTING LanguageContext (session
// state — "what language is this browser talking to ElectionCanon in")
// and the EXISTING uiStrings.js dictionary (resources). Not a new context,
// not a new provider, not a second source of truth about which language is
// selected — it reads useLanguageSession() exactly like AskAssistant.jsx
// already does, and adds nothing except the t() lookup.
// ============================================================

import { useLanguageSession } from "./LanguageContext.jsx";
import { t as translate } from "./uiStrings.js";

/** `const { t } = useTranslation();` then `t("nav.home")` anywhere under
 *  <LanguageProvider>. Falls back to English the same way
 *  useLanguageSession() itself does when called outside a provider. */
export function useTranslation() {
  const { language } = useLanguageSession();
  return { t: (key, vars) => translate(key, language, vars), language };
}

export default useTranslation;

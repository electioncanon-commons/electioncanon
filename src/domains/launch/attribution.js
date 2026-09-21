// ============================================================
// LAUNCH DISTRIBUTION — ATTRIBUTION (Alpha 1.7)
//
// Session id and referral/UTM capture for the public /launch surfaces.
// Deliberately NOT part of src/domains/election/ -- this is marketing
// telemetry about the public site, not election Canon data, and never
// touches election_events, campaigns, or any tenant-scoped table.
//
// session_id is a random, per-browser-session id (sessionStorage-backed,
// cleared when the tab closes) -- never an email or account id, and
// never sent anywhere except as the session_id column on
// launch_analytics_events (see that migration's own header on why this
// is anonymous telemetry, not PII).
//
// LAST-TOUCH ATTRIBUTION. A ?ref=/?utm_*= present in the URL overwrites
// whatever was previously stored for this session; visiting a plain
// link with no params preserves whatever attribution was already
// captured earlier in the same session, so a signup a few clicks later
// still credits the referral/campaign that actually brought the visitor
// in.
// ============================================================

const SESSION_KEY = "electioncanon_launch_session_id";
const ATTRIBUTION_KEY = "electioncanon_launch_attribution";

function storage() {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null; // private browsing / storage disabled -- degrade honestly, never throw
  }
}

export function getOrCreateSessionId() {
  const s = storage();
  if (!s) return cryptoRandomId();
  try {
    const existing = s.getItem(SESSION_KEY);
    if (existing) return existing;
    const fresh = cryptoRandomId();
    s.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    return cryptoRandomId();
  }
}

function cryptoRandomId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/** Reads ?ref=/?utm_source=/?utm_medium=/?utm_campaign= from a location.search string and persists them (last-touch) if present. Always returns the current stored attribution (new or previously captured). */
export function captureAttributionFromSearch(search) {
  const s = storage();
  const params = new URLSearchParams(search || "");
  const incoming = {
    referralId: params.get("ref"),
    utmSource: params.get("utm_source"),
    utmMedium: params.get("utm_medium"),
    utmCampaign: params.get("utm_campaign"),
  };
  const hasIncoming = Object.values(incoming).some((v) => v);

  if (!s) return hasIncoming ? incoming : { referralId: null, utmSource: null, utmMedium: null, utmCampaign: null };

  try {
    if (hasIncoming) {
      s.setItem(ATTRIBUTION_KEY, JSON.stringify(incoming));
      return incoming;
    }
    const stored = s.getItem(ATTRIBUTION_KEY);
    return stored ? JSON.parse(stored) : { referralId: null, utmSource: null, utmMedium: null, utmCampaign: null };
  } catch {
    return incoming;
  }
}

export function getStoredAttribution() {
  const s = storage();
  if (!s) return { referralId: null, utmSource: null, utmMedium: null, utmCampaign: null };
  try {
    const stored = s.getItem(ATTRIBUTION_KEY);
    return stored ? JSON.parse(stored) : { referralId: null, utmSource: null, utmMedium: null, utmCampaign: null };
  } catch {
    return { referralId: null, utmSource: null, utmMedium: null, utmCampaign: null };
  }
}

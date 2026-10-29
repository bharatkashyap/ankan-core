export type LandingVariant = "context" | "habit";
export type LandingSource = "organic" | "other";

const assignmentKey = "ankan_landing_variant_v1";
const visitKey = "ankan_landing_visit_v1";

export function landingVariant(): LandingVariant {
  const preview = new URLSearchParams(window.location.search).get("variant");
  if (preview === "context" || preview === "habit") return preview;
  try {
    const assigned = localStorage.getItem(assignmentKey);
    if (assigned === "context" || assigned === "habit") return assigned;
    const next: LandingVariant = crypto.getRandomValues(new Uint32Array(1))[0] % 2 === 0 ? "context" : "habit";
    localStorage.setItem(assignmentKey, next);
    return next;
  } catch {
    return "context";
  }
}

export function landingSource(): LandingSource {
  const medium = new URLSearchParams(window.location.search).get("utm_medium")?.toLowerCase();
  if (medium === "organic") return "organic";
  try {
    const host = new URL(document.referrer).hostname.toLowerCase();
    if (/(^|\.)(google|bing|yahoo|duckduckgo|ecosia|brave|baidu|yandex)\./.test(host)) return "organic";
  } catch { /* No referrer is available. */ }
  return "other";
}

export function rememberLandingVisit(variant: LandingVariant, source: LandingSource) {
  try { sessionStorage.setItem(visitKey, JSON.stringify({ variant, source })); } catch { /* Storage may be unavailable. */ }
}

export function recentLandingVisit(): { variant: LandingVariant; source: LandingSource } | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(visitKey) || "null");
    if ((value?.variant === "context" || value?.variant === "habit") &&
      (value?.source === "organic" || value?.source === "other")) return value;
  } catch { /* Ignore invalid session data. */ }
  return null;
}

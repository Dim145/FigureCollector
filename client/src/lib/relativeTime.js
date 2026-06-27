// Coarse "il y a {X}" relative time, i18n-driven, shared so feature surfaces
// don't each reinvent it. Returns "" for a missing/invalid timestamp. The
// returned phrase already includes the locale's wrapping ("il y a …" / "… ago",
// keys `time.ago.*`).
export function relativeAgo(iso, t) {
  if (!iso) return "";
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const sec = Math.max(0, (Date.now() - ms) / 1000);
  if (sec < 60) return t("time.ago.s", { n: Math.floor(sec) });
  if (sec < 3600) return t("time.ago.m", { n: Math.floor(sec / 60) });
  if (sec < 86400) return t("time.ago.h", { n: Math.floor(sec / 3600) });
  return t("time.ago.d", { n: Math.floor(sec / 86400) });
}

/** True when `iso` is older than `hours` (default 48h) — for staleness cues. */
export function olderThan(iso, hours = 48) {
  if (!iso) return false;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) && Date.now() - ms > hours * 3600 * 1000;
}

/** Absolute locale timestamp for tooltips. "" on invalid input. */
export function absoluteTime(iso, locale) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(locale || undefined);
}

/** Clamp a read-percent to an integer 0–100 (defensive against odd payloads). */
export function clampPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** color-mix helper — keep accent translucency in oklab, theme-var safe. */
export function mix(accent, pct) {
  return `color-mix(in oklab, ${accent} ${pct}%, transparent)`;
}

/**
 * color-mix helper for the compare spread — keeps accent translucency in oklab
 * and theme-var safe (accepts `var(--…)` tokens). `pct` is the accent's share
 * over transparent.
 */
export function mixAccent(accent, pct) {
  return `color-mix(in oklab, ${accent} ${pct}%, transparent)`;
}

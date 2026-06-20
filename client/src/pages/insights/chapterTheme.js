// =============================================================================
// Shared theming helpers for the Insights almanac chapters.
//
// Page-local (insights/ only) — NOT a shared component folder. Holds the
// per-chapter accent map + the two colour helpers every chapter/chart reuses,
// so the chapter rhythm reads in one coherent palette without re-declaring it
// in each file.
// =============================================================================

/**
 * Per-chapter accent — each entry is a theme var that flips light/dark (never a
 * raw hex). Drives the chapter-rule glyphs + assorted dividers/chips so each
 * section opens in its own light while the gold/ink surfaces stay dominant.
 */
export const CHAPTER_ACCENT = {
  II: "var(--color-neon-amber)",
  III: "var(--color-jade)",
  IV: "var(--color-or)",
  V: "var(--color-indigo)",
  VI: "var(--color-laque-bright)",
  VII: "var(--color-neon-cyan)",
  VIII: "var(--color-laque-bright)",
  IX: "var(--color-jade)",
  X: "var(--color-or)",
  XI: "var(--color-indigo)",
  XII: "var(--color-neon-cyan)",
};

/** color-mix helper — keep accent translucency in oklab, theme-var safe. */
export function colorMix(accentVar, pct) {
  return `color-mix(in oklab, ${accentVar} ${pct}%, transparent)`;
}

// Currencies with no minor unit — never show decimals for these.
const ZERO_DECIMALS = new Set(["JPY", "KRW", "VND", "IDR"]);

/**
 * Format a BARE amount (no currency symbol) for the ledger. The chapters print
 * the ISO code separately (brass tab / trailing span), so unlike the shared
 * `<Money>` / `lib/money.js#fmtMoney` this intentionally omits the symbol to
 * avoid a doubled-up "€3 248 EUR". Locale-grouped, zero-decimal aware.
 */
export function fmtAmount(raw, currency, locale) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return "—";
  const maxFrac = ZERO_DECIMALS.has(currency) ? 0 : 2;
  return n.toLocaleString(locale || undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac,
  });
}

/**
 * Tonal staircase (bright champagne → deep bronze) at FULL opacity, kept inside
 * the Vitrine gold/bronze family. Stepping lightness (and easing the hue warmer
 * as it darkens) keeps every donut/legend segment legible on the dark ground;
 * a deeper light-theme staircase keeps contrast on the near-white surface.
 */
export function segmentColor(i) {
  const dark = [
    "oklch(0.86 0.09 84)",
    "oklch(0.75 0.115 80)",
    "oklch(0.65 0.12 74)",
    "oklch(0.56 0.11 66)",
    "oklch(0.49 0.10 58)",
    "oklch(0.64 0.055 92)",
    "oklch(0.55 0.05 88)",
    "oklch(0.47 0.05 80)",
    "oklch(0.41 0.045 70)",
    "oklch(0.36 0.04 62)",
  ];
  const light = [
    "oklch(0.64 0.13 72)",
    "oklch(0.56 0.13 66)",
    "oklch(0.49 0.12 58)",
    "oklch(0.43 0.11 50)",
    "oklch(0.38 0.10 44)",
    "oklch(0.58 0.06 86)",
    "oklch(0.50 0.055 80)",
    "oklch(0.44 0.05 72)",
    "oklch(0.39 0.045 64)",
    "oklch(0.34 0.04 56)",
  ];
  const isLight =
    typeof document !== "undefined" && document.documentElement.dataset.theme === "light";
  const tiers = isLight ? light : dark;
  return tiers[i] ?? (isLight ? "oklch(0.30 0.03 56)" : "oklch(0.33 0.03 60)");
}

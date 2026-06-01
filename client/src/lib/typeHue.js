// Maps a figure_type slug to its signature hue (the "light" each type casts).
// Each type's pristine per-theme default lives in index.css as `--type-<slug>`
// (in :root + [data-theme="light"]). Admins can override any type's colour from
// /admin/figure-types; <TypeAccentVars> injects that override as a SEPARATE
// `--type-accent-<slug>` var on :root, and this helper reads it with the
// pristine `--type-<slug>` as fallback. So consumers (glows, borders, chips,
// gradients) pick up the custom colour when set, yet the base var is never
// shadowed — the admin colour picker reads it to preview/reset to the true
// default. The final `var(..., gold)` fallback covers uncoloured / admin-added
// types — always a safe, on-brand colour.

/** CSS color for a type slug, e.g.
 *  `var(--type-accent-scale, var(--type-scale, var(--color-or)))`. */
export function typeHue(slug) {
  const s = (slug ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
  if (!s) return "var(--color-or)";
  return `var(--type-accent-${s}, var(--type-${s}, var(--color-or)))`;
}

/** Convenience: inline style object exposing the hue as `--hue` so a
 *  component's CSS (glow, ring, gradient) can reference one variable. */
export function hueVars(slug) {
  return { "--hue": typeHue(slug) };
}

// Single-kanji glyph for each figure_type — the "museum specimen" mark used as
// a thumbnail fallback across the app. `玩` ("toy") covers unknown / admin-added
// types so a new type never renders a stray Latin letter.
const TYPE_KANJI = {
  nendoroid: "童", scale: "像", figma: "動", prize: "賞", trading: "交",
  statue: "彫", plamo: "組", bishoujo: "美", dakimakura: "枕", other: "玩",
};

/** Kanji glyph for a figure_type slug, with the `玩` fallback. */
export function typeKanji(slug) {
  return TYPE_KANJI[slug] || "玩";
}

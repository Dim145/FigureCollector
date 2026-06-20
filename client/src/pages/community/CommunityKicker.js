/**
 * The shared Communauté kicker string for the three community pages, built in
 * the house "SECTION · 漢字 · SOUS-PAGE" idiom (mirrors PreordersPage's
 * "PRÉ-COMMANDES · 予約 · HORARIUM"). 縁 is the section glyph (the same one the
 * nav uses for Communauté); the third token names the sub-page.
 *
 *   communityKicker(t, "COLLECTIONNEURS") → "COMMUNAUTÉ · 縁 · COLLECTIONNEURS"
 */
export function communityKicker(t, subpage) {
  const head = t("nav.community", { default: "Communauté" }).toUpperCase();
  return `${head} · 縁 · ${subpage}`;
}

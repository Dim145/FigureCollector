// Centralises the lifecycle vocabulary so the cards, badges and detail page
// all derive the same label/color/visibility from the same data.

/**
 * Pre-order phases — what we surface in the UI vs the verbose DB-level set:
 *
 *   DB statuses:  announced, preorder_open, preordered, in_production,
 *                 released, shipped, received, cancelled
 *
 *   UI phases:
 *     "preorder" : the user has placed the order, release date is in the
 *                  future. Wraps announced / preorder_open / preordered /
 *                  in_production.
 *     "imminent" : the figurine has released (or is shipping) but hasn't
 *                  landed in the user's hands yet. Wraps released / shipped.
 *     "received" : the box is on the shelf — no badge.
 *     "cancelled": dropped — kept around historically.
 *
 * Owned items without a linked preorder + release_date in the future are
 * also surfaced as "preorder" (catalog-derived), so the badge still appears
 * for items added before the figure had any preorder row.
 */
export function preorderPhase(owned) {
  if (!owned) return null;
  const status = owned.preorder_status;
  if (status) {
    if (status === "received") return "received";
    if (status === "cancelled") return "cancelled";
    if (status === "released" || status === "shipped") return "imminent";
    return "preorder";
  }
  // Fallback: no linked preorder, but the catalog says it's not out yet.
  if (owned.figure_release_date && isFutureDate(owned.figure_release_date)) {
    return "preorder";
  }
  return null;
}

export function preorderPhaseFromFigure(figure) {
  if (!figure?.release_date) return null;
  if (isFutureDate(figure.release_date)) return "preorder";
  return null;
}

function isFutureDate(d) {
  // Accepts "YYYY-MM-DD" or any Date-parseable string. We compare against
  // *today's* date in the local timezone — close-enough for a UI signal,
  // and the server is the source of truth anyway.
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date >= today;
}

/**
 * Translated short label for a UI phase. Pass the `t` from useT().
 * Returns null when no badge should be shown.
 */
export function preorderBadgeLabel(phase, t) {
  switch (phase) {
    case "preorder":  return t("preorder.badge.preorder");
    case "imminent":  return t("preorder.badge.imminent");
    case "cancelled": return t("preorder.badge.cancelled");
    case "received":
    default:          return null;
  }
}

// Shared real-height → standee width (px), for the to-scale diorama / planner /
// public showcase. A 1/4 statue should tower over a Nendoroid. Driven by the
// catalogue `height_mm`; falls back to a per-type typical height when missing.
// Clamped so the smallest piece stays legible and the tallest doesn't blow up
// the row. Width drives it because the standee card is a locked 3:4 portrait —
// scaling width scales the whole frame, and pieces are bottom-aligned so taller
// ones rise above their neighbours.

const TYPE_HEIGHT_MM = {
  nendoroid: 100,
  figma: 145,
  scale: 240,
  prize: 170,
  trading: 70,
  statue: 340,
  plamo: 180,
  bishoujo: 230,
  dakimakura: 300,
  other: 190,
};

/** @param {{height_mm?: number|null, figure_type?: string}} o */
export function standeeWidthPx(o) {
  const h = o.height_mm || TYPE_HEIGHT_MM[o.figure_type] || 190;
  return Math.round(Math.min(210, Math.max(64, h * 0.5)));
}

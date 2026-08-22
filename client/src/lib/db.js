import Dexie from "dexie";

/**
 * On-device store — the offline half of the PWA promise.
 *
 * `dexie` has been a declared dependency (and a reserved Vite chunk) since the
 * PWA work, and the docs have claimed "new mutations queue and dispatch on
 * reconnect", but nothing ever imported it: TanStack Query's `offlineFirst`
 * mode fails a mutation once and drops it. This is that missing layer.
 *
 * Two tables, deliberately small:
 *
 *  - **pieces** — a thin mirror of what you own / covet (name, maker, barcode,
 *    thumbnail id). Enough to answer the two questions a collector has with no
 *    signal, in a convention hall or a shop basement: *do I already have this?*
 *    (scan the barcode) and *what was I after?* Not a full offline copy of the
 *    catalogue — that would be a large, stale liability on the device.
 *  - **outbox** — mutations made while offline, replayed in order on reconnect.
 *
 * This is personal data at rest on the device, so [`purgeLocalData`] wipes it
 * on sign-out.
 */
export const db = new Dexie("figurecollector");

db.version(1).stores({
  // figure_id is the natural key; `jan` and `kind` are indexed for the scan
  // lookup and the owned/wished split.
  pieces: "figure_id, jan, kind, name",
  // Auto-incrementing id keeps replay in the order the user acted.
  outbox: "++id, created_at, kind",
});

/** Replace the mirror for one side (owned | wish) in a single transaction. */
export async function syncMirror(kind, rows) {
  if (!Array.isArray(rows)) return;
  const mapped = rows.map((r) => ({
    figure_id: r.figure_id,
    kind,
    name: r.figure_name ?? "",
    manufacturer: r.manufacturer_name ?? null,
    jan: r.jan ?? null,
    photo_id: r.cover_photo_id ?? r.catalog_cover_photo_id ?? null,
    condition: r.condition ?? null,
  }));
  await db.transaction("rw", db.pieces, async () => {
    await db.pieces.where("kind").equals(kind).delete();
    if (mapped.length) await db.pieces.bulkPut(mapped);
  });
}

/**
 * Offline answer to "do I already have this?" for a scanned barcode.
 * Returns the mirrored row, or null. Exact match only — a fuzzy barcode hit
 * would be worse than no answer at the moment of buying.
 */
export async function findByBarcode(jan) {
  const code = String(jan ?? "").trim();
  if (!code) return null;
  return (await db.pieces.where("jan").equals(code).first()) ?? null;
}

/** Wipe every on-device trace. Called on sign-out. */
export async function purgeLocalData() {
  try {
    await db.delete();
  } catch {
    /* a locked/blocked DB must never block signing out */
  }
}

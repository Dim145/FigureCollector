// Resolution order for an owned item's display thumbnail:
//   1. user's pinned photo  (per-user)         /api/photos/{id}
//   2. user's pinned scan, frame 0 (per-user)  /api/scans/{id}/frames/0
//   3. catalog primary photo                   /api/figure-photos/{id}
//   4. official_image_url (raw, may be external)
//   5. null → SPA renders the SVG placeholder
//
// Used by both CollectionPage cards and the cover picker UI.
export function resolveOwnedCover(item) {
  if (!item) return null;
  if (item.cover_photo_id) {
    // `?v=storage_key` busts the CacheFirst service-worker cache when the
    // pinned photo is edited in place (id stays, bytes change); without it the
    // grid keeps the stale thumbnail until the 30-day cache entry expires.
    const v = item.cover_photo_key
      ? `?v=${encodeURIComponent(item.cover_photo_key)}`
      : "";
    return `/api/photos/${item.cover_photo_id}${v}`;
  }
  if (item.cover_scan_id) return `/api/scans/${item.cover_scan_id}/frames/0`;
  if (item.catalog_cover_photo_id) return `/api/figure-photos/${item.catalog_cover_photo_id}`;
  if (item.figure_image) return item.figure_image;
  return null;
}

/**
 * Resolution chain for a *catalog* figure (no per-user data). Used by the
 * BrowsePage card and the admin catalog table.
 *   1. uploaded catalog primary photo            /api/figure-photos/{id}
 *   2. official_image_url (legacy / AniList)
 *   3. null → SPA renders the SVG placeholder
 */
export function resolveFigureCover(figure) {
  return resolveFigureCoverSources(figure).primary;
}

/**
 * Same chain as {@link resolveFigureCover}, but exposes BOTH the primary URL and
 * the alternate source to fall back to when the primary fails to load. The
 * uploaded catalog photo (`/api/figure-photos`) is preferred, with the external
 * `official_image_url` as the fallback source — so a card whose proxied cover
 * times out, or whose hotlinked store-CDN image gets rate-limited, can recover
 * from the other source instead of staying silently broken. Consumed by
 * `useCoverImage` (the <img> retry/fallback state machine).
 */
export function resolveFigureCoverSources(figure) {
  if (!figure) return { primary: null, fallback: null };
  const photo = figure.primary_photo_id
    ? `/api/figure-photos/${figure.primary_photo_id}`
    : null;
  const official = figure.official_image_url || null;
  return photo ? { primary: photo, fallback: official } : { primary: official, fallback: null };
}

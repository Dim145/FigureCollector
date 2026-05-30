# Photos & 360° scans

## Two photo layers

FigureCollector keeps **catalogue photos** and **personal photos** strictly separate:

| Layer | Stored where | Visible to | Use case |
|---|---|---|---|
| Catalogue photos | `figure_photos` table | Everyone (shared) | Official manufacturer renders, prototype shots, box art |
| Personal photos | `photos` table | The owner only | Your specific copy of the piece |

Both are stored in S3 (or the filesystem fallback) and served via signed URLs through the backend (no direct bucket exposure).

## Multi-upload (catalogue)

On the figure detail page, the catalogue-photos section accepts **multiple files at once**. Each tile shows its own loading state (印 kanji + kintsugi-stripe animation) and self-dismisses when the upload settles. Errors stay on screen with a dismiss button.

Per-file uploads fire **in parallel** via `Promise.all` — they don't block each other.

## Editing a photo

Any uploaded photo can be **edited in place** — the same editor that opens before
a new upload (crop, rotate, filters, and local background removal) reopens on an
existing shot via the ✎ button on its thumbnail. Saving replaces the image
without changing its position or which photo is the cover.

Permissions mirror upload: a **personal** photo can only be edited (and seen) by
its owner; a **catalogue** photo can be edited by an admin or the figure's
creator. Because photos are now mutable, the binary proxies revalidate with an
`ETag` instead of caching forever — so an edit propagates everywhere the photo
appears (cover, cards, hero, lightbox), not just the gallery you edited it in.

## Per-user cover

The figure card on `/collection` shows, in order of priority:

1. The user's pinned cover (`cover_photo_id` or `cover_scan_id`) — set from the "Couverture" foldable.
2. The figure's catalogue primary photo (`is_primary = true` on `figure_photos`).
3. The first photo in position order.
4. The figure's `official_image_url` (legacy AniList fallback).
5. A placeholder SVG.

## Lightbox with zoom

Clicking any photo opens a focus-trapped fullscreen lightbox with:

- **Click-to-zoom** at the click point (2.5× from fit, stays under the cursor)
- **Wheel zoom** anchored at the cursor (1×–5×)
- **Drag-to-pan** while zoomed, clamped so the image edges can't cross the container center
- **`0` key** resets to fit
- Single-finger touch pan when zoomed (no pinch yet)
- Zoom indicator chip top-left: `拡 250% · 0 = fit`

Wheel is attached natively with `{ passive: false }` because React's synthetic onWheel is passive and would silently no-op the gesture.

## 360° turntable scans

Per owned item, a **Vue 360°** foldable opens a capture wizard that records a sequence of frames you can scrub through after the fact. The wizard runs background-removal locally via `@imgly/background-removal` (ONNX Runtime, lazy-loaded so users who never use this feature don't pay the bundle cost).

The viewer uses `gsplat` for Gaussian splat rendering.

## NSFW interaction

Personal + catalogue photos respect the user's NSFW preference (see [NSFW handling](nsfw.md)):

- **show** → all photos visible
- **blur** → NSFW figures blurred (CSS filter), photo upload disabled on NSFW figures
- **hide** → NSFW figures hidden entirely from the catalogue

The visibility flag lives on the `figures` row, not on the photos themselves — every photo of an NSFW figure inherits the blur class.

import { useMemo, useRef, useState } from "react";
import { useT } from "../i18n/index.jsx";
import {
  useDeleteFigurePhoto,
  useFigurePhotos,
  useReplaceFigurePhoto,
  useSetPrimaryFigurePhoto,
  useUploadFigurePhoto,
} from "../hooks/useFigurePhotos.js";
import Lightbox from "./Lightbox.jsx";
import PhotoEditor from "./PhotoEditor.jsx";

/* Monotonic id for pending-upload tasks — uniquely identifies a tile
 * across the lifetime of the section even if the user picks 5 files
 * with the same name in quick succession. */
let UPLOAD_SEQ = 0;

/**
 * Catalog-side photo gallery for a single figure. Visible to everyone (it
 * IS the catalog data); upload / star-primary / delete only show up when
 * `canEdit` (admin or figure creator) is true.
 *
 * Layout: a responsive grid (auto-fill, min 160px tile) — the previous
 * horizontal-scroll strip was banned because it required mouse-wheel
 * acrobatics to see anything past the 6th tile. The grid wraps naturally
 * onto as many rows as the viewport needs.
 */
export default function FigurePhotosSection({ figureId, figureName, canEdit, uploadDisabled = false, blurImages = false }) {
  const t = useT();
  const photos = useFigurePhotos(figureId);
  const upload = useUploadFigurePhoto(figureId);
  const replace = useReplaceFigurePhoto(figureId);
  const setPrimary = useSetPrimaryFigurePhoto(figureId);
  const del = useDeleteFigurePhoto(figureId);
  const fileInput = useRef(null);
  const [lightbox, setLightbox] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  // Per-file upload tasks rendered as placeholder tiles AHEAD of the
  // grid. Each carries its own status (uploading / error) so the user
  // sees granular progress when they batch 5+ photos at once.
  const [pendingUploads, setPendingUploads] = useState([]);

  const onPick = (e) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    // Stage tasks immediately so the placeholder tiles appear before
    // the network round-trips begin — this is the "all 5 squares
    // show up at once with loading states" UX the user asked for.
    const tasks = files.map((file) => ({
      id: ++UPLOAD_SEQ,
      name: file.name,
      size: file.size,
      status: "uploading",
      errorMessage: null,
    }));
    setPendingUploads((prev) => [...prev, ...tasks]);

    // Fire all uploads in parallel. TanStack's `mutateAsync` supports
    // concurrent calls — each returns its own promise. The shared
    // `onSuccess` invalidates `["figure-photos", figureId]` so the
    // newly-arrived photos land in `list` as they're uploaded; the
    // pending tile fades out as it's removed from local state.
    tasks.forEach((task, i) => {
      const file = files[i];
      upload
        .mutateAsync(file)
        .then(() => {
          setPendingUploads((prev) => prev.filter((t) => t.id !== task.id));
        })
        .catch((err) => {
          setPendingUploads((prev) =>
            prev.map((t) =>
              t.id === task.id
                ? {
                    ...t,
                    status: "error",
                    errorMessage: err?.message ?? "Upload failed",
                  }
                : t,
            ),
          );
        });
    });
  };

  const dismissUpload = (id) => {
    setPendingUploads((prev) => prev.filter((t) => t.id !== id));
  };

  // Edit-in-place: pull an existing catalog photo back into the editor, then
  // PUT the edited result over the same row (admin/creator only — the band
  // that exposes this is already gated by `canEdit`, and the backend re-checks).
  const startEdit = async (p) => {
    try {
      const res = await fetch(`/api/figure-photos/${p.id}`, { credentials: "include" });
      const blob = await res.blob();
      setEditTarget({
        id: p.id,
        file: new File([blob], "edit.webp", { type: blob.type || "image/webp" }),
      });
    } catch {
      /* leave the grid untouched on a fetch hiccup */
    }
  };
  const onReplace = async (editedBlob) => {
    const out = new File([editedBlob], "edit.webp", {
      type: editedBlob.type || "image/webp",
    });
    await replace.mutateAsync({ photoId: editTarget.id, file: out });
    setEditTarget(null);
  };

  const list = photos.data ?? [];
  // Pre-compute the shape the shared Lightbox expects: a flat
  // `{ src, alt }` list, indexed the same way as `list`.
  const lightboxSlides = useMemo(
    () =>
      list.map((p, i) => ({
        src: fbSrc(p),
        alt: `${figureName ?? ""} — ${i + 1}`,
      })),
    [list, figureName],
  );
  // Nothing to show + nothing to do.
  if (!canEdit && list.length === 0) return null;

  return (
    <section>
      <header className="flex items-baseline justify-between mb-4">
        <div>
          <p className="micro">{t("figure.catalog_photos.eyebrow")}</p>
          <h2 className="display text-2xl text-[var(--color-ivoire)] mt-1">
            {t("figure.catalog_photos.title")}
          </h2>
        </div>
        {canEdit ? (
          uploadDisabled ? (
            <span
              title={t("nsfw.upload_blocked_hint")}
              className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-ivoire-soft)]/50 cursor-not-allowed"
            >
              {t("nsfw.upload_blocked")}
            </span>
          ) : (
            <>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={onPick}
              />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-or)] hover:text-[var(--color-or-pale)] transition-colors"
              >
                ＋ {t("figure.catalog_photos.upload")}
              </button>
            </>
          )
        ) : null}
      </header>

      {upload.error ? (
        <p
          role="alert"
          className="text-xs text-[var(--color-laque-bright)] border-l-2 border-[var(--color-laque-bright)] pl-2 py-1 mb-3"
        >
          {upload.error.message}
        </p>
      ) : null}

      {list.length === 0 && pendingUploads.length === 0 ? (
        <p className="text-sm text-[var(--color-ivoire-soft)] italic">
          {t("figure.catalog_photos.empty")}
        </p>
      ) : (
        <ul
          className="grid gap-3"
          style={{
            // auto-fill with a min tile width: each row fits as many
            // 160px tiles as the column allows, then wraps. The 1fr cap
            // lets the last row's tiles grow slightly so there's no
            // dead trailing whitespace.
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          }}
        >
          {/* Pending uploads first — they appear immediately when the
              picker closes, before the network roundtrip. Each tile
              shows its own loading state and self-dismisses when the
              upload settles (or stays as an error chip until the user
              dismisses it). */}
          {pendingUploads.map((task) => (
            <UploadTile key={`pending-${task.id}`} task={task} onDismiss={dismissUpload} t={t} />
          ))}
          {list.map((p, i) => (
            <li
              key={p.id}
              className="group/photo relative aspect-square bg-[var(--color-noir-deep)] border border-[var(--color-or)]/15 overflow-hidden"
            >
              {/* Same blurred-backdrop treatment as FigureCard's well:
                  ambient color fills the letterbox bars left by
                  `object-contain` so landscape figure shots don't read
                  as half-empty next to portrait ones. */}
              <img
                src={fbSrc(p)}
                alt=""
                aria-hidden
                loading="lazy"
                decoding="async"
                className={`absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-45 pointer-events-none ${blurImages ? "nsfw-blur" : ""}`}
              />
              <button
                type="button"
                onClick={() => setLightbox(i)}
                aria-label={t("photos.view")}
                className="absolute inset-0 w-full h-full z-[1]"
              >
                <img
                  src={fbSrc(p)}
                  alt={`${figureName ?? t("photos.view")} — ${i + 1}`}
                  loading="lazy"
                  decoding="async"
                  className={`w-full h-full object-contain p-2 transition-transform duration-500 group-hover/photo:scale-[1.03] ${blurImages ? "nsfw-blur" : ""}`}
                />
              </button>

              {p.is_primary ? (
                // `z-[2]` lifts the chip above the lightbox-trigger button
                // (which sits at `z-[1]`); without it the figure image
                // covers the chip visually. `pointer-events-none` keeps
                // clicks falling through to the lightbox button so the
                // chip is purely decorative.
                <span
                  className="absolute top-1.5 left-1.5 z-[2] chip chip--solid pointer-events-none"
                  style={{ fontSize: "9px", padding: "0.15em 0.5em" }}
                >
                  {t("figure.catalog_photos.primary")}
                </span>
              ) : null}

              {canEdit ? (
                // Hover action band — must sit ABOVE the lightbox-trigger
                // button (z-[1]) so the ★ and × buttons are actually
                // clickable. Default `pointer-events-none` lets clicks
                // pass through to the lightbox button when the band is
                // invisible (opacity-0), then re-enabled on hover so the
                // delete/make-primary buttons receive their clicks.
                <div className="absolute bottom-0 left-0 right-0 z-[2] bg-[var(--color-noir)]/85 backdrop-blur-sm border-t border-[var(--color-or)]/15 px-2 py-1.5 flex items-center justify-between gap-2 opacity-0 pointer-events-none group-hover/photo:opacity-100 group-hover/photo:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto transition-opacity">
                  {!p.is_primary ? (
                    <button
                      type="button"
                      onClick={() => setPrimary.mutate(p.id)}
                      disabled={setPrimary.isPending}
                      title={t("figure.catalog_photos.make_primary")}
                      className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-or)] hover:text-[var(--color-or-pale)] disabled:opacity-50 transition-colors"
                    >
                      ★ {t("figure.catalog_photos.make_primary")}
                    </button>
                  ) : (
                    <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-or-pale)]/60">
                      ★ {t("figure.catalog_photos.primary")}
                    </span>
                  )}
                  <div className="flex items-center gap-2.5">
                    {!uploadDisabled ? (
                      <button
                        type="button"
                        onClick={() => startEdit(p)}
                        disabled={replace.isPending}
                        title={t("figure.catalog_photos.edit")}
                        className="text-[12px] text-[var(--color-or)] hover:text-[var(--color-or-pale)] disabled:opacity-50 transition-colors"
                      >
                        ✎
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => del.mutate(p.id)}
                      disabled={del.isPending}
                      title={t("figure.catalog_photos.delete")}
                      className="text-[12px] text-[var(--color-ivoire-soft)] hover:text-[var(--color-laque-bright)] disabled:opacity-50 transition-colors"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Lightbox
        open={lightbox !== null}
        slides={lightboxSlides}
        index={lightbox ?? 0}
        onChange={setLightbox}
        onClose={() => setLightbox(null)}
      />

      {editTarget ? (
        <PhotoEditor
          file={editTarget.file}
          onUpload={onReplace}
          onCancel={() => setEditTarget(null)}
        />
      ) : null}
    </section>
  );
}

/** Catalog-photo proxy URL with a cache-buster keyed on storage_key — the
 *  proxy serves `immutable`, so editing in place (same id) needs the URL to
 *  change for the new image to show without a hard reload. */
function fbSrc(p) {
  const token = (p.storage_key || "").split("/").pop() || p.id;
  return `/api/figure-photos/${p.id}?v=${encodeURIComponent(token)}`;
}

/**
 * Placeholder rendered for each file currently being uploaded — appears
 * immediately when the picker closes, fades out as the upload settles.
 *
 * Two visual states:
 *   - uploading: faint pulsing gold border, animated kintsugi diagonal
 *                stripes (匠 aesthetic), centred 印 (seal) glyph rotating
 *                gently, filename + size at the bottom.
 *   - error:     red sash across the top, error text replaces the kanji,
 *                "dismiss" × on hover so the user can clear the failed
 *                tile (the file picker can be re-opened to retry).
 */
function UploadTile({ task, onDismiss, t }) {
  const isError = task.status === "error";
  return (
    <li
      className={`group/upload relative aspect-square overflow-hidden border ${
        isError
          ? "border-[var(--color-laque-bright)]/60 bg-[var(--color-laque)]/8"
          : "border-[var(--color-or)]/30 bg-[var(--color-noir-deep)] upload-tile-pulse"
      }`}
      aria-live="polite"
      aria-label={
        isError
          ? t("figure.catalog_photos.upload_failed", {
              name: task.name,
              default: `Upload failed: ${task.name}`,
            })
          : t("figure.catalog_photos.upload_pending", {
              name: task.name,
              default: `Uploading ${task.name}…`,
            })
      }
    >
      {!isError ? (
        <>
          {/* Animated kintsugi-style diagonal stripes — quiet motion that
              reads as "in progress" without screaming. */}
          <div className="absolute inset-0 upload-stripes pointer-events-none" aria-hidden />
          {/* Centred rotating seal — 印 (stamp) sits at the heart of the
              tile, slow spin. Telegraphs "we're registering this photo
              into the catalogue". */}
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <span
              aria-hidden
              className="ja text-5xl text-[var(--color-or)]/55 upload-spin select-none"
              style={{ textShadow: "0 0 18px oklch(0.78 0.10 80 / 0.35)" }}
            >
              印
            </span>
          </div>
        </>
      ) : (
        <>
          {/* Error sash + glyph */}
          <span
            className="absolute top-2 left-2 chip chip--solid pointer-events-none"
            style={{
              fontSize: "9px",
              padding: "0.15em 0.55em",
              background: "var(--color-laque-bright)",
              color: "var(--color-ivoire)",
            }}
          >
            !
          </span>
          <div className="absolute inset-0 grid place-items-center px-3 text-center pointer-events-none">
            <p className="text-[10.5px] uppercase tracking-[0.18em] text-[var(--color-laque-bright)] leading-snug">
              {task.errorMessage}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onDismiss(task.id)}
            aria-label={t("editor.cancel")}
            className="absolute top-1.5 right-1.5 w-6 h-6 grid place-items-center text-[var(--color-ivoire-soft)] hover:text-[var(--color-laque-bright)] text-base leading-none transition-colors"
          >
            ×
          </button>
        </>
      )}

      {/* Footer ribbon: filename + size. Always visible so the user can
          tell which tile is theirs in a batch upload. */}
      <div className="absolute bottom-0 left-0 right-0 bg-[var(--color-noir)]/85 backdrop-blur-sm border-t border-[var(--color-or)]/15 px-2 py-1.5">
        <p className="font-mono text-[10px] tracking-tight text-[var(--color-ivoire-soft)] truncate">
          {task.name}
        </p>
        <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[var(--color-or-pale)]/60">
          {formatBytes(task.size)}
        </p>
      </div>
    </li>
  );
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

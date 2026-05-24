import { useRef, useState } from "react";
import { useT } from "../i18n/index.jsx";
import {
  useDeleteFigurePhoto,
  useFigurePhotos,
  useSetPrimaryFigurePhoto,
  useUploadFigurePhoto,
} from "../hooks/useFigurePhotos.js";

/**
 * Catalog-side photo gallery for a single figure. Visible to everyone (it
 * IS the catalog data); upload / star-primary / delete only show up when
 * `canEdit` (admin or figure creator) is true.
 *
 * Layout: a horizontal scrolling strip of tiles; the primary photo is
 * called out with a gold sash. Hover reveals the action overlay.
 */
export default function FigurePhotosSection({ figureId, canEdit, uploadDisabled = false, blurImages = false }) {
  const t = useT();
  const photos = useFigurePhotos(figureId);
  const upload = useUploadFigurePhoto(figureId);
  const setPrimary = useSetPrimaryFigurePhoto(figureId);
  const del = useDeleteFigurePhoto(figureId);
  const fileInput = useRef(null);
  const [lightbox, setLightbox] = useState(null);

  const onPick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    upload.mutate(file);
  };

  const list = photos.data ?? [];
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
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={onPick}
              />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={upload.isPending}
                className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-or)] hover:text-[var(--color-or-pale)] disabled:opacity-50 transition-colors"
              >
                {upload.isPending
                  ? t("figure.catalog_photos.uploading")
                  : `＋ ${t("figure.catalog_photos.upload")}`}
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

      {list.length === 0 ? (
        <p className="text-sm text-[var(--color-ivoire-soft)] italic">
          {t("figure.catalog_photos.empty")}
        </p>
      ) : (
        <ul className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
          {list.map((p, i) => (
            <li
              key={p.id}
              className="shrink-0 group/photo relative w-40 h-40 bg-[var(--color-noir-deep)] border border-[var(--color-or)]/15 overflow-hidden"
            >
              <button
                type="button"
                onClick={() => setLightbox(i)}
                aria-label={t("photos.view")}
                className="absolute inset-0 w-full h-full"
              >
                <img
                  src={`/api/figure-photos/${p.id}`}
                  alt=""
                  loading="lazy"
                  className={`w-full h-full object-cover transition-transform duration-500 group-hover/photo:scale-105 ${blurImages ? "nsfw-blur" : ""}`}
                />
              </button>

              {p.is_primary ? (
                <span
                  className="absolute top-1.5 left-1.5 chip chip--solid pointer-events-none"
                  style={{ fontSize: "9px", padding: "0.15em 0.5em" }}
                >
                  {t("figure.catalog_photos.primary")}
                </span>
              ) : null}

              {canEdit ? (
                <div className="absolute bottom-0 left-0 right-0 bg-[var(--color-noir)]/85 backdrop-blur-sm border-t border-[var(--color-or)]/15 px-2 py-1.5 flex items-center justify-between gap-2 opacity-0 group-hover/photo:opacity-100 transition-opacity">
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
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {lightbox !== null ? (
        <Lightbox
          photos={list}
          index={lightbox}
          onChange={setLightbox}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </section>
  );
}

function Lightbox({ photos, index, onChange, onClose }) {
  const photo = photos[index];
  if (!photo) return null;
  return (
    <div
      role="dialog"
      aria-modal
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-[var(--color-noir)]/95 backdrop-blur-sm"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] text-3xl leading-none transition-colors"
      >
        ×
      </button>
      {photos.length > 1 ? (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange((index - 1 + photos.length) % photos.length);
            }}
            className="absolute left-4 md:left-8 top-1/2 -translate-y-1/2 text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] text-4xl transition-colors"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange((index + 1) % photos.length);
            }}
            className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] text-4xl transition-colors"
          >
            ›
          </button>
        </>
      ) : null}
      <img
        src={`/api/figure-photos/${photo.id}`}
        alt=""
        onClick={(e) => e.stopPropagation()}
        className="max-w-[92vw] max-h-[88vh] object-contain border border-[var(--color-or)]/30"
      />
    </div>
  );
}

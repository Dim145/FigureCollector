import { useRef } from "react";
import { useT } from "../i18n/index.jsx";
import {
  useDeletePhoto,
  usePhotos,
  useUploadPhoto,
} from "../hooks/useProfile.js";

/**
 * Phase 2B — horizontal photo strip with upload + delete.
 * Shown on FigureDetailPage when the user owns the figure.
 */
export default function PhotoStrip({ ownedId }) {
  const t = useT();
  const photos = usePhotos(ownedId);
  const upload = useUploadPhoto(ownedId);
  const remove = useDeletePhoto(ownedId);
  const fileInput = useRef(null);

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    upload.mutate(file);
    e.target.value = "";
  };

  return (
    <section>
      <header className="flex items-baseline justify-between mb-3">
        <h2 className="micro">{t("photos.title")}</h2>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={upload.isPending}
          className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-or)] hover:text-[var(--color-or-pale)] disabled:opacity-50"
        >
          {upload.isPending ? t("photos.uploading") : t("photos.upload")}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={onFile}
        />
      </header>

      {upload.error ? (
        <p
          role="alert"
          className="text-xs text-[var(--color-laque-bright)] border-l-2 border-[var(--color-laque-bright)] pl-2 py-1 mb-3"
        >
          {upload.error.message}
        </p>
      ) : null}

      {photos.data?.length ? (
        <ul className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
          {photos.data.map((p) => (
            <li key={p.id} className="shrink-0 group relative">
              <img
                src={`/api/photos/${p.id}`}
                alt=""
                width={p.width}
                height={p.height}
                className="h-32 w-auto object-cover border border-[var(--color-or)]/20"
                loading="lazy"
              />
              <button
                type="button"
                onClick={() => remove.mutate(p.id)}
                disabled={remove.isPending}
                title={t("photos.remove")}
                className="absolute top-1 right-1 bg-[var(--color-noir)]/80 border border-[var(--color-laque-bright)] text-[var(--color-laque-bright)] w-6 h-6 text-xs grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--color-ivoire-soft)] italic">
          {t("photos.empty")}
        </p>
      )}
    </section>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../i18n/index.jsx";
import {
  useDeletePhoto,
  usePhotos,
  useReplacePhoto,
  useUploadPhoto,
} from "../hooks/useProfile.js";
import PhotoEditor from "./PhotoEditor.jsx";

/**
 * Horizontal photo strip with edit-before-upload workflow.
 *   1. user clicks "Ajouter une photo"
 *   2. file picker opens
 *   3. instead of uploading right away, we mount <PhotoEditor> on the file
 *   4. when the user clicks "Save" inside the editor, we upload the edited blob
 *
 * The editor itself is lazy-loaded (filerobot + @imgly bg-removal) so this
 * code path never inflates the initial bundle.
 */
export default function PhotoStrip({ ownedId, figureName, uploadDisabled = false, blurImages = false }) {
  const t = useT();
  const photos = usePhotos(ownedId);
  const upload = useUploadPhoto(ownedId);
  const replace = useReplacePhoto(ownedId);
  const remove = useDeletePhoto(ownedId);
  const fileInput = useRef(null);

  const [pickedFile, setPickedFile] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [lightboxIndex, setLightboxIndex] = useState(null);

  const onFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPickedFile(file);
  };

  const onUpload = async (editedBlob) => {
    // wrap the Blob into a File so the multipart name + filename make sense
    const out = new File([editedBlob], deriveName(pickedFile, editedBlob), {
      type: editedBlob.type || "image/webp",
    });
    await upload.mutateAsync(out);
    setPickedFile(null);
  };

  // Edit-in-place: pull the existing photo back into the editor, then PUT the
  // edited result over the same row.
  const startEdit = async (p) => {
    try {
      const res = await fetch(`/api/photos/${p.id}`, { credentials: "include" });
      const blob = await res.blob();
      setEditTarget({
        id: p.id,
        file: new File([blob], "edit.webp", { type: blob.type || "image/webp" }),
      });
    } catch {
      /* network hiccup — leave the strip untouched */
    }
  };

  const onReplace = async (editedBlob) => {
    const out = new File([editedBlob], "edit.webp", {
      type: editedBlob.type || "image/webp",
    });
    await replace.mutateAsync({ photoId: editTarget.id, file: out });
    setEditTarget(null);
  };

  return (
    <section>
      <header className="flex items-baseline justify-between mb-3">
        <h2 className="micro">{t("photos.title")}</h2>
        {uploadDisabled ? (
          <span
            title={t("nsfw.upload_blocked_hint")}
            className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)]/50 cursor-not-allowed"
          >
            {t("nsfw.upload_blocked")}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={upload.isPending}
            className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-or)] hover:text-[var(--color-or-pale)] disabled:opacity-50"
          >
            {upload.isPending ? t("photos.uploading") : t("photos.upload")}
          </button>
        )}
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
          {photos.data.map((p, i) => (
            <li key={p.id} className="shrink-0 group relative">
              <button
                type="button"
                onClick={() => setLightboxIndex(i)}
                aria-label={t("photos.view")}
                className="block focus:outline-none focus:ring-2 focus:ring-[var(--color-or)]/60"
              >
                <img
                  src={photoSrc(p)}
                  alt={`${figureName ?? t("photos.view")} — ${i + 1}`}
                  width={p.width}
                  height={p.height}
                  className={`h-32 w-auto object-cover border border-[var(--color-or)]/20 cursor-zoom-in transition-opacity group-hover:opacity-85 ${blurImages ? "nsfw-blur" : ""}`}
                  loading="lazy"
                  decoding="async"
                />
              </button>
              {!uploadDisabled ? (
                <button
                  type="button"
                  onClick={() => startEdit(p)}
                  disabled={replace.isPending}
                  title={t("photos.edit")}
                  className="absolute top-1 right-8 bg-[var(--color-noir)]/80 border border-[var(--color-or)] text-[var(--color-or)] w-6 h-6 text-xs grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                >
                  ✎
                </button>
              ) : null}
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

      {pickedFile ? (
        <PhotoEditor
          file={pickedFile}
          onUpload={onUpload}
          onCancel={() => setPickedFile(null)}
        />
      ) : null}

      {editTarget ? (
        <PhotoEditor
          file={editTarget.file}
          onUpload={onReplace}
          onCancel={() => setEditTarget(null)}
        />
      ) : null}

      {lightboxIndex !== null && photos.data ? (
        <PhotoLightbox
          photos={photos.data}
          index={lightboxIndex}
          onChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      ) : null}
    </section>
  );
}

/**
 * Fullscreen photo viewer. ←/→ navigate, Esc closes, click outside the
 * image closes too. The image is sized via `object-contain` so portrait
 * and landscape originals both fit without cropping.
 */
function PhotoLightbox({ photos, index, onChange, onClose }) {
  const t = useT();
  const photo = photos[index];

  const go = useCallback(
    (delta) => {
      const next = (index + delta + photos.length) % photos.length;
      onChange(next);
    },
    [index, photos.length, onChange],
  );

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  if (!photo) return null;

  return (
    <div
      role="dialog"
      aria-modal
      aria-label={t("photos.view")}
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-[var(--color-noir)]/95 backdrop-blur-sm"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t("editor.cancel")}
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
              go(-1);
            }}
            aria-label={t("photos.prev")}
            className="absolute left-4 md:left-8 top-1/2 -translate-y-1/2 text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] text-4xl leading-none transition-colors"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            aria-label={t("photos.next")}
            className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] text-4xl leading-none transition-colors"
          >
            ›
          </button>
        </>
      ) : null}

      <img
        key={photo.id}
        src={photoSrc(photo)}
        alt=""
        onClick={(e) => e.stopPropagation()}
        className="max-w-[92vw] max-h-[88vh] object-contain border border-[var(--color-or)]/30 cursor-default"
        style={{ boxShadow: "0 60px 120px -60px rgba(0,0,0,0.85)" }}
      />

      {photos.length > 1 ? (
        <p className="absolute bottom-4 left-1/2 -translate-x-1/2 font-mono text-[11px] tracking-wider text-[var(--color-or-pale)]">
          {index + 1} / {photos.length}
        </p>
      ) : null}
    </div>
  );
}

/** Photo proxy URL with a cache-buster keyed on storage_key — the proxy
 *  serves `immutable`, so editing in place (same id) needs the URL to change
 *  for the new image to show without a hard reload. */
function photoSrc(p) {
  const token = (p.storage_key || "").split("/").pop() || p.id;
  return `/api/photos/${p.id}?v=${encodeURIComponent(token)}`;
}

function deriveName(originalFile, blob) {
  const ext = (blob.type || "").split("/")[1] ?? "webp";
  const base = (originalFile?.name ?? "photo").replace(/\.[a-z0-9]+$/i, "");
  return `${base}.${ext}`;
}

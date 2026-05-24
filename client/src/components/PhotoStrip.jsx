import { useRef, useState } from "react";
import { useT } from "../i18n/index.jsx";
import {
  useDeletePhoto,
  usePhotos,
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
export default function PhotoStrip({ ownedId }) {
  const t = useT();
  const photos = usePhotos(ownedId);
  const upload = useUploadPhoto(ownedId);
  const remove = useDeletePhoto(ownedId);
  const fileInput = useRef(null);

  const [pickedFile, setPickedFile] = useState(null);

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

      {pickedFile ? (
        <PhotoEditor
          file={pickedFile}
          onUpload={onUpload}
          onCancel={() => setPickedFile(null)}
        />
      ) : null}
    </section>
  );
}

function deriveName(originalFile, blob) {
  const ext = (blob.type || "").split("/")[1] ?? "webp";
  const base = (originalFile?.name ?? "photo").replace(/\.[a-z0-9]+$/i, "");
  return `${base}.${ext}`;
}

import { Suspense, lazy, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/index.jsx";
import { removeBackground } from "../lib/bgRemoval.js";

// Filerobot is ~1 MB — code-split it so it only ships when the editor opens.
const FilerobotImageEditor = lazy(() => import("react-filerobot-image-editor"));

/**
 * Modal photo editor:
 *   - filerobot for crop / rotate / flip / finetune (brightness, contrast,
 *     saturation, blur, warmth, hue) / filters / annotations / resize
 *   - dedicated "Remove background" action that runs BiRefNet (MIT) locally
 *     in the browser (no upload) and feeds the cutout back into filerobot
 *   - on save, calls `onUpload(blob)` with the rendered Blob.
 *
 * @param {File} file              the freshly-picked image
 * @param {(blob: Blob) => Promise<void>} onUpload
 * @param {() => void} onCancel
 */
export default function PhotoEditor({ file, onUpload, onCancel }) {
  const t = useT();
  const [currentBlob, setCurrentBlob] = useState(file);
  const [currentUrl, setCurrentUrl] = useState(() => URL.createObjectURL(file));
  const [bgState, setBgState] = useState({ running: false, progress: 0, error: null });
  const [uploading, setUploading] = useState(false);

  // Manage object-URL lifecycle.
  useEffect(() => {
    return () => {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [currentUrl]);

  const swapBlob = (next) => {
    setCurrentBlob(next);
    setCurrentUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(next);
    });
  };

  const onRemoveBg = async () => {
    setBgState({ running: true, progress: 0, error: null });
    try {
      // transformers.js reports a single object per file:
      // `{ status, name, file, progress /* 0-100 */, loaded, total }`. Only the
      // download phase carries a percentage — the load/inference phases just
      // change `status`, so we hold the bar rather than snapping it back to 0.
      const cutout = await removeBackground(currentBlob, (p) => {
        const pct =
          typeof p?.progress === "number"
            ? Math.round(p.progress)
            : p?.total
              ? Math.round((p.loaded / p.total) * 100)
              : null;
        if (pct != null) {
          setBgState((s) => ({ ...s, progress: Math.max(s.progress, Math.min(pct, 99)) }));
        }
      });
      swapBlob(cutout);
      setBgState({ running: false, progress: 100, error: null });
    } catch (e) {
      setBgState({ running: false, progress: 0, error: e?.message ?? "error" });
    }
  };

  const onSave = async (edited) => {
    // Filerobot returns either a Blob (recent versions) or a base64 dataURL.
    let blob;
    if (edited?.imageBase64) {
      blob = base64ToBlob(edited.imageBase64);
    } else if (edited?.imageBlob instanceof Blob) {
      blob = edited.imageBlob;
    } else if (edited?.imageData) {
      blob = await imageDataToBlob(edited.imageData);
    } else {
      throw new Error("filerobot returned unexpected payload");
    }
    setUploading(true);
    try {
      await onUpload(blob);
    } finally {
      setUploading(false);
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal
      className="fixed inset-0 z-50 grid place-items-stretch bg-[var(--color-noir)]/95 backdrop-blur-sm"
    >
      {/* Top chrome: title + bg-remove + close */}
      <header className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-6 py-3 border-b border-[var(--color-or)]/20 bg-[var(--color-noir-soft)]/80">
        <h2 className="display text-xl text-[var(--color-ivoire)]">
          {t("editor.title")}
        </h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onRemoveBg}
            disabled={bgState.running || uploading}
            className="px-4 py-1.5 text-[11px] uppercase tracking-[0.18em] border border-[var(--color-or)]/50 text-[var(--color-or)] hover:bg-[var(--color-or)]/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {bgState.running
              ? t("editor.bg_removing", { p: bgState.progress })
              : `✂ ${t("editor.bg_remove")}`}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={uploading}
            aria-label={t("editor.cancel")}
            className="text-[var(--color-ivoire-soft)] hover:text-[var(--color-laque-bright)] text-2xl leading-none transition-colors"
          >
            ×
          </button>
        </div>
      </header>

      {bgState.error ? (
        <div
          role="alert"
          className="absolute top-14 left-6 right-6 z-10 bg-[var(--color-laque)] text-[var(--color-ivoire)] px-4 py-2 text-sm"
        >
          {t("editor.bg_error")}: {bgState.error}
        </div>
      ) : null}

      <div className="pt-14 h-full">
        <Suspense
          fallback={
            <div className="grid place-items-center h-full text-[var(--color-ivoire-soft)] text-sm">
              {t("editor.loading_editor")}
            </div>
          }
        >
          <FilerobotImageEditor
            key={currentUrl}
            source={currentUrl}
            onSave={onSave}
            onClose={onCancel}
            // Direction A skin. The palette is mapped to our theme tokens via
            // var() so the editor follows the app's dark/light theme; the
            // `.FIE_*` CSS overrides in index.css do the finer polish (fonts,
            // squared corners, gold hairlines, the hanko-red Save pill).
            theme={{
              palette: {
                "bg-primary": "var(--color-noir)",
                "bg-primary-active": "var(--color-noir-soft)",
                "bg-secondary": "var(--color-noir-soft)",
                "bg-hover": "var(--color-noir-soft)",
                "bg-active": "var(--color-noir-soft)",
                "bg-stateless": "var(--color-noir)",
                "accent-primary": "var(--color-or)",
                "accent-primary-active": "var(--color-or-pale)",
                "accent-primary-hover": "var(--color-or-pale)",
                "accent-stateless": "var(--color-or)",
                accent: "var(--color-or)",
                "text-primary": "var(--color-ivoire)",
                "txt-primary": "var(--color-ivoire)",
                "text-secondary": "var(--color-ivoire-soft)",
                "txt-secondary": "var(--color-ivoire-soft)",
                "text-primary-invert": "var(--color-noir)",
                "text-active": "var(--color-or)",
                "icons-primary": "var(--color-ivoire-soft)",
                "icon-primary": "var(--color-ivoire-soft)",
                "icons-secondary": "var(--color-or)",
                "icons-primary-hover": "var(--color-or)",
                "borders-primary": "color-mix(in oklab, var(--color-or) 22%, transparent)",
                "borders-secondary": "color-mix(in oklab, var(--color-or) 14%, transparent)",
                "border-primary-stateless": "color-mix(in oklab, var(--color-or) 22%, transparent)",
                "borders-strong": "color-mix(in oklab, var(--color-or) 34%, transparent)",
                "link-primary": "var(--color-or-pale)",
                "link-primary-active": "var(--color-or)",
                "active-secondary": "var(--color-or)",
                "light-shadow": "rgba(0, 0, 0, 0.5)",
                error: "var(--color-laque-bright)",
                warning: "var(--color-laque-bright)",
                success: "var(--color-jade)",
              },
              typography: {
                fontFamily: "var(--font-sans)",
              },
            }}
            // "Filters" is intentionally omitted: in filerobot v4.9.1 the
            // Filters tab leaves the MAIN preview blank (the image vanishes —
            // only the filter thumbnails render). Confirmed a pre-existing
            // upstream bug (it reproduces with our theme removed), and artistic
            // Instagram-style filters aren't useful for figure photos anyway —
            // Finetune covers brightness/contrast/saturation/etc. Re-add
            // "Filters" if upstream fixes it (e.g. on the v5 line).
            tabsIds={["Adjust", "Finetune", "Annotate", "Watermark", "Resize"]}
            defaultTabId="Adjust"
            defaultToolId="Crop"
            // Output dimensions follow the edit, never a forced size:
            //   · no crop / no resize → full original resolution (savingPixelRatio
            //     stays at filerobot's default 4 = "up to the original resolution";
            //     the old savingPixelRatio:1 override was what downscaled saves to
            //     the ~1080 on-screen canvas, NOT the absence of a resize seed)
            //   · crop  → the cropped region's own dimensions
            //   · resize → whatever the user types in the Resize tab
            // We deliberately DON'T seed loadableDesignState.resize: a seeded
            // width+height is replayed as a *forced* final resize on every save,
            // so after a crop the cropped box got stretched back to the original
            // aspect ratio — the deformation bug.
            previewPixelRatio={window.devicePixelRatio ?? 1}
            // Save as WebP by default: it preserves the alpha channel of a
            // background-removed cutout (the source's JPG/etc. default would
            // flatten the transparency onto black) and compresses photos well.
            // The save dialog still lets the user pick another format.
            defaultSavedImageType="webp"
            // Disable filerobot's online translation fetch — it phones home to
            // i18n-fastly.ultrafast.io which our CSP (rightly) blocks, and we ship
            // our own translations anyway.
            useBackendTranslations={false}
            disableSaveIfNoChanges={false}
          />
        </Suspense>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Convert a `data:image/...;base64,<payload>` URL to a Blob without ever
 * touching the network. `fetch(dataUrl)` would work in browsers, but CSP
 * sees it as a `connect-src data:` violation (which is correct — data URLs
 * are not network resources and we don't want to widen the CSP just to
 * tolerate this).
 */
function base64ToBlob(dataUrl) {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("malformed data URL");
  const header = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  const mime = /^data:([^;]+)/.exec(header)?.[1] ?? "application/octet-stream";
  const bin = atob(payload);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function imageDataToBlob(imageData) {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext("2d").putImageData(imageData, 0, 0);
  return new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/webp", 0.92),
  );
}

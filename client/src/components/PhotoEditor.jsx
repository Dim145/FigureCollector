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
 *   - dedicated "Remove background" action that runs @imgly/background-removal
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
  // Natural size of whatever is currently in the editor, tagged with the url it
  // was measured from (so a slow async probe never seeds the wrong size after a
  // bg-removal swap). It seeds filerobot's Resize tab with the real dimensions,
  // which makes the resize default to a no-op — so saving no longer forces a
  // downscale, and the inputs read the current image, not a fixed 1080.
  const [loaded, setLoaded] = useState(null);
  const [bgState, setBgState] = useState({ running: false, progress: 0, error: null });
  const [uploading, setUploading] = useState(false);

  // Manage object-URL lifecycle.
  useEffect(() => {
    return () => {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [currentUrl]);

  // Measure the source's natural dimensions for the Resize default.
  useEffect(() => {
    let cancelled = false;
    const probe = new Image();
    probe.onload = () => {
      if (!cancelled) {
        setLoaded({ url: currentUrl, width: probe.naturalWidth, height: probe.naturalHeight });
      }
    };
    probe.src = currentUrl;
    return () => {
      cancelled = true;
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
      // @imgly/background-removal's progress callback takes three positional
      // args, NOT a single object. Reading `p?.total` from a `key` string
      // silently always fell through and kept the bar pinned at 0 % until
      // the call resolved.
      const cutout = await removeBackground(currentBlob, (_key, current, total) => {
        if (total) {
          setBgState((s) => ({
            ...s,
            progress: Math.round((current / total) * 100),
          }));
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
          {loaded?.url === currentUrl ? (
            <FilerobotImageEditor
              key={currentUrl}
              source={currentUrl}
              // Seed the Resize tab with the image's real dimensions: it then
              // defaults to a no-op (resize is optional, not a forced downscale)
              // and the inputs show the current image's size, not a fixed 1080.
              loadableDesignState={{
                resize: { width: loaded.width, height: loaded.height },
              }}
              onSave={onSave}
              onClose={onCancel}
              theme={{
                palette: {
                  "bg-primary": "var(--color-noir)",
                  "bg-secondary": "var(--color-noir-soft)",
                  accent: "var(--color-or)",
                  "text-primary": "var(--color-ivoire)",
                  "text-secondary": "var(--color-ivoire-soft)",
                  "text-active": "var(--color-or)",
                  warning: "var(--color-laque-bright)",
                },
                typography: {
                  fontFamily: "Inter, system-ui, sans-serif",
                },
              }}
              tabsIds={["Adjust", "Finetune", "Filters", "Annotate", "Watermark", "Resize"]}
              defaultTabId="Adjust"
              defaultToolId="Crop"
              // Leave savingPixelRatio at filerobot's default (4, "up to the
              // original resolution"); the old override of 1 downscaled every
              // save to the on-screen canvas size (~the forced 1080).
              previewPixelRatio={window.devicePixelRatio ?? 1}
              // Disable filerobot's online translation fetch — it phones home
              // to i18n-fastly.ultrafast.io which our CSP (rightly) blocks and
              // we ship our own translations anyway.
              useBackendTranslations={false}
              disableSaveIfNoChanges={false}
            />
          ) : (
            <div className="grid place-items-center h-full text-[var(--color-ivoire-soft)] text-sm">
              {t("editor.loading_editor")}
            </div>
          )}
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

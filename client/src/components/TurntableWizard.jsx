import { useEffect, useState } from "react";
import { useT } from "../i18n/index.jsx";
import { useScanCapabilities } from "../hooks/useScans.js";
import TurntableCapture from "./TurntableCapture.jsx";
import TurntableImport from "./TurntableImport.jsx";
import TurntableVideo from "./TurntableVideo.jsx";

const TABS = ["camera", "video", "import"];

/**
 * Fullscreen wizard with three capture modes plus a Phase 5B toggle for
 * "Generate full 3D model (Gaussian Splatting)". Same capture flows in
 * either mode — the toggle only flips `kind` on submit.
 *
 * The 3D checkbox is gated on `/scans/capabilities` — if no gsplat worker
 * is currently enabled + alive, we hide the checkbox entirely (the backend
 * would 503 the upload anyway). The 360° flow stays available regardless.
 */
export default function TurntableWizard({ onUpload, onCancel, busy }) {
  const t = useT();
  const [tab, setTab] = useState("camera");
  const [generate3d, setGenerate3d] = useState(false);
  const caps = useScanCapabilities();
  const gsplatAvailable = caps.data?.gsplat_available ?? false;

  // If the last worker drops while the wizard is open, untick — otherwise
  // the user could trigger a 503 on submit despite the checkbox not even
  // being visible anymore.
  useEffect(() => {
    if (!gsplatAvailable && generate3d) setGenerate3d(false);
  }, [gsplatAvailable, generate3d]);

  // `video` is the original file (video tab only); we forward it for gsplat
  // so the worker can extract full-res frames rather than the downscaled set.
  // A gsplat upload may be video-only (no frames) — allow it when a video is
  // present; otherwise still require the usual >= 6 frames.
  const handle = async (frames, video = null) => {
    const list = frames || [];
    if (list.length < 6 && !video) return;
    const kind = generate3d ? "gsplat" : "turntable";
    await onUpload(list, kind, kind === "gsplat" ? video : null);
  };

  return (
    <div
      role="dialog"
      aria-modal
      className="fixed inset-0 z-50 bg-[var(--color-noir)]/95 backdrop-blur-sm flex flex-col"
    >
      <header className="flex items-center justify-between gap-4 px-6 py-3 border-b border-[var(--color-or)]/20 bg-[var(--color-noir-soft)]/80">
        <div className="min-w-0">
          <p className="micro">{t("turntable.wizard.subtitle")}</p>
          <h2 className="display text-xl text-[var(--color-ivoire)] mt-0.5 truncate">
            {t("turntable.wizard.title")}
          </h2>
        </div>

        <nav className="flex items-center gap-1 text-[11px] uppercase tracking-[0.18em]">
          {TABS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 transition-colors ${
                tab === key
                  ? "text-[var(--color-or)] border-b border-[var(--color-or)]"
                  : "text-[var(--color-ivoire-soft)] hover:text-[var(--color-or-pale)]"
              }`}
            >
              {t(`turntable.wizard.tab.${key}`)}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          {gsplatAvailable ? (
            <label className="hidden md:flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={generate3d}
                onChange={(e) => setGenerate3d(e.target.checked)}
                className="accent-[var(--color-or)] w-4 h-4"
              />
              <span
                className={
                  generate3d
                    ? "text-[var(--color-or)]"
                    : "text-[var(--color-ivoire-soft)]"
                }
              >
                🧊 {t("turntable.wizard.generate_3d")}
              </span>
            </label>
          ) : null}
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label={t("editor.cancel")}
            className="text-[var(--color-ivoire-soft)] hover:text-[var(--color-laque-bright)] text-2xl leading-none transition-colors"
          >
            ×
          </button>
        </div>
      </header>

      {/* Mobile-only toggle row — same capabilities gate as the desktop one. */}
      {gsplatAvailable ? (
        <div className="md:hidden flex items-center justify-end gap-2 px-6 py-2 border-b border-[var(--color-or)]/15 text-[10px] uppercase tracking-[0.18em]">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={generate3d}
              onChange={(e) => setGenerate3d(e.target.checked)}
              className="accent-[var(--color-or)] w-4 h-4"
            />
            <span
              className={
                generate3d
                  ? "text-[var(--color-or)]"
                  : "text-[var(--color-ivoire-soft)]"
              }
            >
              🧊 {t("turntable.wizard.generate_3d")}
            </span>
          </label>
        </div>
      ) : null}

      {generate3d ? (
        <div className="px-6 py-2 bg-[var(--color-or)]/10 border-b border-[var(--color-or)]/20">
          <p className="text-xs text-[var(--color-or-pale)] text-center">
            {t("turntable.wizard.gsplat_hint")}
          </p>
        </div>
      ) : null}

      <div className="flex-1 overflow-hidden">
        {tab === "camera" && <TurntableCapture onComplete={handle} />}
        {tab === "video" && <TurntableVideo onComplete={handle} gsplat={generate3d} />}
        {tab === "import" && <TurntableImport onComplete={handle} />}
      </div>

      {busy ? (
        <div
          className="absolute inset-0 bg-[var(--color-noir)]/85 grid place-items-center"
          aria-live="polite"
        >
          <div className="text-center">
            <p className="display text-2xl text-[var(--color-or)]">
              {t("turntable.uploading")}
            </p>
            <p className="micro mt-3">{t("turntable.uploading_hint")}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

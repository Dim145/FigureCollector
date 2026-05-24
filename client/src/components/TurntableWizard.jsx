import { useState } from "react";
import { useT } from "../i18n/index.jsx";
import TurntableCapture from "./TurntableCapture.jsx";
import TurntableImport from "./TurntableImport.jsx";
import TurntableVideo from "./TurntableVideo.jsx";

const TABS = ["camera", "video", "import"];

/**
 * Fullscreen wizard with three capture modes. Each mode hands back an array
 * of Blob frames; this wraps them in the upload callback supplied by the
 * caller (PhotoStrip / TurntableSection).
 */
export default function TurntableWizard({ onUpload, onCancel, busy }) {
  const t = useT();
  const [tab, setTab] = useState("camera");

  const handle = async (frames) => {
    if (!frames || frames.length < 6) return;
    await onUpload(frames);
  };

  return (
    <div
      role="dialog"
      aria-modal
      className="fixed inset-0 z-50 bg-[var(--color-noir)]/95 backdrop-blur-sm flex flex-col"
    >
      <header className="flex items-center justify-between px-6 py-3 border-b border-[var(--color-or)]/20 bg-[var(--color-noir-soft)]/80">
        <div>
          <p className="micro">{t("turntable.wizard.subtitle")}</p>
          <h2 className="display text-xl text-[var(--color-ivoire)] mt-0.5">
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
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          aria-label={t("editor.cancel")}
          className="text-[var(--color-ivoire-soft)] hover:text-[var(--color-laque-bright)] text-2xl leading-none transition-colors"
        >
          ×
        </button>
      </header>

      <div className="flex-1 overflow-hidden">
        {tab === "camera" && <TurntableCapture onComplete={handle} />}
        {tab === "video" && <TurntableVideo onComplete={handle} />}
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

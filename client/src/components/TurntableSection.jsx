import { useState } from "react";
import { useT } from "../i18n/index.jsx";
import {
  useCreateScan,
  useDeleteScan,
  useScans,
} from "../hooks/useScans.js";
import TurntableViewer from "./TurntableViewer.jsx";
import TurntableWizard from "./TurntableWizard.jsx";

/**
 * Section rendered on FigureDetailPage when the user owns the figure.
 *   - no scan yet → "Add 360° scan" button → opens wizard
 *   - one or more scans → display the latest viewer + replace / delete actions
 */
export default function TurntableSection({ ownedId }) {
  const t = useT();
  const scans = useScans(ownedId);
  const create = useCreateScan(ownedId);
  const remove = useDeleteScan(ownedId);
  const [wizardOpen, setWizardOpen] = useState(false);

  const ready = (scans.data ?? []).filter((s) => s.state === "ready");
  const latest = ready[0];

  const onUpload = async (frames) => {
    try {
      await create.mutateAsync({ frames, kind: "turntable" });
      setWizardOpen(false);
    } catch (e) {
      // Error surfaced via mutation state; keep wizard open so user can retry.
      // eslint-disable-next-line no-console
      console.warn("[turntable] upload failed", e);
    }
  };

  return (
    <section>
      <header className="flex items-baseline justify-between mb-3">
        <h2 className="micro">{t("turntable.section.title")}</h2>
        <div className="flex items-center gap-3">
          {latest ? (
            <button
              type="button"
              onClick={() => {
                if (confirm(t("turntable.section.confirm_replace"))) {
                  remove.mutate(latest.id);
                }
              }}
              className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)] hover:text-[var(--color-laque-bright)] transition-colors"
            >
              {t("turntable.section.replace")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-or)] hover:text-[var(--color-or-pale)]"
          >
            {latest
              ? t("turntable.section.add_more")
              : t("turntable.section.add_first")}
          </button>
        </div>
      </header>

      {create.error ? (
        <p role="alert" className="text-xs text-[var(--color-laque-bright)] border-l-2 border-[var(--color-laque-bright)] pl-2 py-1 mb-3">
          {create.error.message}
        </p>
      ) : null}

      {latest ? (
        <div className="max-w-md">
          <TurntableViewer scanId={latest.id} frameCount={latest.frame_count} />
          <p className="micro mt-2">
            {t("turntable.section.frame_count", { n: latest.frame_count })}
          </p>
        </div>
      ) : (
        <p className="text-sm text-[var(--color-ivoire-soft)] italic">
          {t("turntable.section.empty")}
        </p>
      )}

      {wizardOpen ? (
        <TurntableWizard
          onUpload={onUpload}
          onCancel={() => setWizardOpen(false)}
          busy={create.isPending}
        />
      ) : null}
    </section>
  );
}

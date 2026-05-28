import { useState } from "react";
import { useT } from "../i18n/index.jsx";
import {
  useCreateScan,
  useDeleteScan,
  useScans,
} from "../hooks/useScans.js";
import ConfirmDialog from "./ConfirmDialog.jsx";
import GsplatViewer from "./GsplatViewer.jsx";
import TurntableViewer from "./TurntableViewer.jsx";
import TurntableWizard from "./TurntableWizard.jsx";

/**
 * Section rendered on FigureDetailPage when the user owns the figure.
 * Phase 5A: turntable viewer. Phase 5B: branches on the latest scan's kind
 * and state to render either:
 *   - turntable + ready                → drag-to-rotate viewer
 *   - gsplat   + ready + result_key    → Gaussian Splatting WebGL viewer
 *   - gsplat   + pending / processing  → "Training in progress" state
 *   - gsplat   + failed                → error + retry button
 */
export default function TurntableSection({ ownedId }) {
  const t = useT();
  const scans = useScans(ownedId);
  const create = useCreateScan(ownedId);
  const remove = useDeleteScan(ownedId);
  const [wizardOpen, setWizardOpen] = useState(false);
  // Scan-id queued for confirmation; null when the dialog is closed.
  // Replaces a `window.confirm()` that couldn't be styled or focus-trapped.
  const [pendingReplaceId, setPendingReplaceId] = useState(null);

  const all = scans.data ?? [];
  const readyGsplat = all.find(
    (s) => s.kind === "gsplat" && s.state === "ready" && s.result_key,
  );
  const inFlightGsplat = all.find(
    (s) => s.kind === "gsplat" && (s.state === "pending" || s.state === "processing"),
  );
  const failedGsplat = all.find((s) => s.kind === "gsplat" && s.state === "failed");
  const latestTurntable = all.find((s) => s.kind === "turntable" && s.state === "ready");

  const onUpload = async (frames, kind, video = null) => {
    try {
      await create.mutateAsync({ frames, kind, video });
      setWizardOpen(false);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[scan] upload failed", e);
    }
  };

  const replaceLatest = (scanId) => {
    if (!scanId) return;
    setPendingReplaceId(scanId);
  };

  return (
    <section>
      <header className="flex items-baseline justify-between mb-3">
        <h2 className="micro">{t("turntable.section.title")}</h2>
        <div className="flex items-center gap-3">
          {readyGsplat || latestTurntable ? (
            <button
              type="button"
              onClick={() =>
                replaceLatest(readyGsplat?.id ?? latestTurntable?.id)
              }
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
            {readyGsplat || latestTurntable
              ? t("turntable.section.add_more")
              : t("turntable.section.add_first")}
          </button>
        </div>
      </header>

      {create.error ? (
        <p
          role="alert"
          className="text-xs text-[var(--color-laque-bright)] border-l-2 border-[var(--color-laque-bright)] pl-2 py-1 mb-3"
        >
          {create.error.message}
        </p>
      ) : null}

      <div className="max-w-md">
        {readyGsplat ? (
          <>
            <GsplatViewer scanId={readyGsplat.id} />
            <p className="micro mt-2">{t("gsplat.viewer_label")}</p>
          </>
        ) : inFlightGsplat ? (
          <ProcessingNotice
            state={inFlightGsplat.state}
            fallback={latestTurntable}
            t={t}
          />
        ) : failedGsplat ? (
          <FailureNotice
            scan={failedGsplat}
            t={t}
            onRetry={() => setWizardOpen(true)}
          />
        ) : latestTurntable ? (
          <>
            <TurntableViewer
              scanId={latestTurntable.id}
              frameCount={latestTurntable.frame_count}
            />
            <p className="micro mt-2">
              {t("turntable.section.frame_count", {
                n: latestTurntable.frame_count,
              })}
            </p>
          </>
        ) : (
          <p className="text-sm text-[var(--color-ivoire-soft)] italic">
            {t("turntable.section.empty")}
          </p>
        )}
      </div>

      {wizardOpen ? (
        <TurntableWizard
          onUpload={onUpload}
          onCancel={() => setWizardOpen(false)}
          busy={create.isPending}
        />
      ) : null}

      <ConfirmDialog
        open={!!pendingReplaceId}
        title={t("turntable.section.replace")}
        body={t("turntable.section.confirm_replace")}
        destructive
        busy={remove.isPending}
        onCancel={() => setPendingReplaceId(null)}
        onConfirm={() => {
          if (pendingReplaceId) {
            remove.mutate(pendingReplaceId, {
              onSettled: () => setPendingReplaceId(null),
            });
          }
        }}
      />
    </section>
  );
}

function ProcessingNotice({ state, fallback, t }) {
  return (
    <div className="space-y-3">
      {fallback ? (
        <TurntableViewer scanId={fallback.id} frameCount={fallback.frame_count} />
      ) : (
        <div className="aspect-square w-full bg-[var(--color-noir)] border border-[var(--color-or)]/15 grid place-items-center">
          <p className="ja text-6xl text-[var(--color-or)]/30 animate-pulse">処理中</p>
        </div>
      )}
      <div className="flex items-center gap-2 text-[var(--color-or-pale)]">
        <span className="inline-block w-2 h-2 bg-[var(--color-or)] animate-pulse rounded-full" />
        <span className="micro">
          {state === "processing"
            ? t("gsplat.processing")
            : t("gsplat.pending")}
        </span>
      </div>
      <p className="text-xs text-[var(--color-ivoire-soft)]">
        {t("gsplat.processing_hint")}
      </p>
    </div>
  );
}

function FailureNotice({ scan, t, onRetry }) {
  return (
    <div className="border border-[var(--color-laque-bright)]/40 bg-[var(--color-laque)]/10 p-4 space-y-3">
      <p className="display text-base text-[var(--color-laque-bright)]">
        {t("gsplat.failed")}
      </p>
      {scan.error_message ? (
        <pre className="text-xs text-[var(--color-ivoire-soft)] whitespace-pre-wrap overflow-auto max-h-40 font-mono">
          {scan.error_message.slice(0, 600)}
        </pre>
      ) : null}
      <button
        type="button"
        onClick={onRetry}
        className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-or)] hover:text-[var(--color-or-pale)]"
      >
        {t("gsplat.retry")}
      </button>
    </div>
  );
}

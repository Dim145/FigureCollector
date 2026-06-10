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
 *
 * Two distinct artifacts can coexist on one item:
 *   · 360° view — a `turntable` scan (drag-to-rotate frames)
 *   · 3D model  — a ready `gsplat` scan (Gaussian-Splatting WebGL)
 *
 * Display rules:
 *   - both present        → a segmented toggle (360° | 3D), defaulting to 360°
 *   - one present         → that view, with its label, no toggle
 *   - 360° present + a 3D job still training / failed → 360° + a status strip
 *   - no ready view       → the gsplat job's processing / failed / empty notice
 */
export default function TurntableSection({ ownedId }) {
  const t = useT();
  const scans = useScans(ownedId);
  const create = useCreateScan(ownedId);
  const remove = useDeleteScan(ownedId);
  const [wizardOpen, setWizardOpen] = useState(false);
  // Which view the toggle shows when both exist. Defaults to 360°.
  const [view, setView] = useState("360");
  // Scan-id queued for confirmation; null when the dialog is closed.
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

  const both = latestTurntable && readyGsplat;

  const onUpload = async (frames, kind, video = null) => {
    try {
      await create.mutateAsync({ frames, kind, video });
      setWizardOpen(false);
    } catch (e) {
      console.warn("[scan] upload failed", e);
    }
  };

  const replaceLatest = (scanId) => {
    if (!scanId) return;
    setPendingReplaceId(scanId);
  };

  const view3d = (
    <>
      <GsplatViewer scanId={readyGsplat?.id} />
      <p className="micro mt-2">{t("gsplat.viewer_label")}</p>
    </>
  );
  const view360 = latestTurntable ? (
    <>
      <TurntableViewer
        scanId={latestTurntable.id}
        frameCount={latestTurntable.frame_count}
      />
      <p className="micro mt-2">
        {t("turntable.section.frame_count", { n: latestTurntable.frame_count })}
      </p>
    </>
  ) : null;

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
        {both ? (
          <>
            <ViewToggle view={view} setView={setView} t={t} />
            {view === "3d" ? view3d : view360}
          </>
        ) : readyGsplat ? (
          view3d
        ) : latestTurntable ? (
          <>
            {view360}
            {inFlightGsplat ? (
              <Status3dStrip kind="processing" progress={inFlightGsplat.progress} t={t} />
            ) : failedGsplat ? (
              <Status3dStrip kind="failed" t={t} onRetry={() => setWizardOpen(true)} />
            ) : null}
          </>
        ) : inFlightGsplat ? (
          <ProcessingNotice
            state={inFlightGsplat.state}
            progress={inFlightGsplat.progress}
            fallback={null}
            t={t}
          />
        ) : failedGsplat ? (
          <FailureNotice
            scan={failedGsplat}
            t={t}
            onRetry={() => setWizardOpen(true)}
          />
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

/** One segment of {@link ViewToggle}. Hoisted to module scope so its component
 *  type is stable across renders (react-hooks/static-components — defining it
 *  inside ViewToggle remounted both buttons on every parent render). */
function ViewTogglePill({ id, kanji, label, view, setView }) {
  return (
    <button
      type="button"
      onClick={() => setView(id)}
      aria-pressed={view === id}
      className={`flex-1 inline-flex items-center justify-center gap-1.5 min-h-[40px] text-[11px] uppercase tracking-[0.14em] transition-colors ${
        id === "3d" ? "border-l border-[var(--color-or)]/20" : ""
      } ${
        view === id
          ? "bg-[color-mix(in_oklab,var(--color-or)_16%,transparent)] text-[var(--color-or)]"
          : "text-[var(--color-ivoire-soft)] hover:text-[var(--color-or-pale)]"
      }`}
    >
      <span className="ja text-base not-italic" aria-hidden>{kanji}</span>
      {label}
    </button>
  );
}

/** Segmented control: 回 Vue 360° | 像 Modèle 3D. Equal-width, ≥40px tall so
 *  the pills are comfortable touch targets on mobile. */
function ViewToggle({ view, setView, t }) {
  return (
    <div className="flex border border-[var(--color-or)]/30 mb-2.5">
      <ViewTogglePill id="360" kanji="回" label={t("scan.view.360")} view={view} setView={setView} />
      <ViewTogglePill id="3d" kanji="像" label={t("scan.view.3d")} view={view} setView={setView} />
    </div>
  );
}

/** Under a 360° view, a one-line status of a 3D job that's still training or
 *  failed — so the user sees the working 360° AND the 3D's state. */
function Status3dStrip({ kind, progress, t, onRetry }) {
  const pct = typeof progress === "number" ? Math.max(0, Math.min(100, progress)) : null;
  const failed = kind === "failed";
  return (
    <div
      className="mt-2 flex items-center gap-2 text-[11px] border-l-2 pl-2 py-0.5"
      style={{
        borderColor: failed
          ? "var(--color-laque-bright)"
          : "color-mix(in oklab, var(--color-or) 45%, transparent)",
        color: failed ? "var(--color-laque-bright)" : "var(--color-or-pale)",
      }}
    >
      {failed ? (
        <>
          <span>{t("scan.strip.3d_failed")}</span>
          <button type="button" onClick={onRetry} className="underline hover:no-underline">
            {t("gsplat.retry")}
          </button>
        </>
      ) : (
        <>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-or)] animate-pulse" />
          <span>{t("scan.strip.3d_processing", { pct: pct ?? 0 })}</span>
        </>
      )}
    </div>
  );
}

function ProcessingNotice({ state, progress, fallback, t }) {
  const pct = typeof progress === "number" ? Math.max(0, Math.min(100, progress)) : null;
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
      {pct != null ? (
        <div className="space-y-1">
          <div className="h-1 bg-[var(--color-or)]/15 overflow-hidden">
            <div
              className="h-full bg-[var(--color-or)] transition-[width] duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-[10px] font-mono text-[var(--color-or-pale)]">{pct}%</p>
        </div>
      ) : null}
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

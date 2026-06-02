import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import {
  useAdminScans,
  useRetryScan,
  useFailScan,
  useDeleteScan,
} from "../hooks/useAdmin.js";
import EmptyState from "../components/EmptyState.jsx";

const OR = "var(--color-or)";
const JADE = "var(--color-jade)";
const LAQUE = "var(--color-laque-bright)";
const INDIGO = "var(--color-indigo-bright)";

const STATE_TONE = {
  pending: OR,
  processing: INDIGO,
  ready: JADE,
  failed: LAQUE,
};

const FILTERS = {
  all: () => true,
  active: (s) => s === "pending" || s === "processing",
  failed: (s) => s === "failed",
  ready: (s) => s === "ready",
};

function clampPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** "il y a 6 s / 4 min / 2 h / 3 j" — coarse relative time. */
function rel(iso, t) {
  if (!iso) return "";
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return t("admin.tasks.ago.s", { n: Math.floor(sec) });
  if (sec < 3600) return t("admin.tasks.ago.m", { n: Math.floor(sec / 60) });
  if (sec < 86400) return t("admin.tasks.ago.h", { n: Math.floor(sec / 3600) });
  return t("admin.tasks.ago.d", { n: Math.floor(sec / 86400) });
}

/** Execution time from claim→finish, "Xm Ys" or "Ys". */
function execTime(claimed, finished) {
  if (!claimed || !finished) return null;
  const sec = Math.round((new Date(finished).getTime() - new Date(claimed).getTime()) / 1000);
  if (sec < 0) return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m} min ${s.toString().padStart(2, "0")} s` : `${s} s`;
}

/**
 * 列 — admin task queue (/admin/tasks). The gsplat scan jobs surfaced with their
 * worker, timings + result, plus retry / force-fail / delete. Polls (admins
 * don't get the per-user scan WebSocket events). Turntables aren't shown — the
 * backend scopes everything to kind='gsplat'.
 */
export default function AdminTasksPage() {
  const t = useT();
  const q = useAdminScans();
  const [filter, setFilter] = useState("all");
  const rows = q.data ?? [];

  const counts = useMemo(() => {
    const c = { all: rows.length, active: 0, failed: 0, ready: 0 };
    for (const r of rows) {
      if (r.state === "pending" || r.state === "processing") c.active++;
      else if (r.state === "failed") c.failed++;
      else if (r.state === "ready") c.ready++;
    }
    return c;
  }, [rows]);

  const shown = rows.filter((r) => FILTERS[filter](r.state));

  return (
    <section className="space-y-7">
      <header className="relative">
        <span
          aria-hidden
          className="ja absolute -top-6 -right-2 text-[10rem] leading-none text-[var(--color-indigo)]/[0.07] select-none pointer-events-none hidden md:block"
        >
          列
        </span>
        <p className="micro">{t("admin.tasks.eyebrow")}</p>
        <h2 className="display text-3xl md:text-4xl text-[var(--color-ivoire)] mt-2">
          {t("admin.tasks.title")}
        </h2>
        <div className="gold-rule w-16 mt-4" />
        <p className="mt-5 text-[var(--color-ivoire-soft)] leading-relaxed max-w-2xl">
          {t("admin.tasks.body")}
        </p>
      </header>

      {/* toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1.5">
          {["all", "active", "failed", "ready"].map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className="text-[10px] uppercase tracking-[0.16em] px-2.5 py-1.5 border transition-colors"
              style={
                filter === f
                  ? { color: OR, borderColor: OR, background: `color-mix(in oklab, ${OR} 10%, transparent)` }
                  : { color: "var(--color-ivoire-soft)", borderColor: "color-mix(in oklab, var(--color-or) 25%, transparent)" }
              }
            >
              {t(`admin.tasks.filter.${f}`)} {counts[f] > 0 ? `· ${counts[f]}` : ""}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <span className="text-[11px] text-[var(--color-ivoire-soft)]">
          🧹 {t("admin.tasks.cleanup")}
        </span>
      </div>

      {q.isLoading ? (
        <p className="text-center text-[var(--color-ivoire-soft)] py-12">…</p>
      ) : shown.length === 0 ? (
        <EmptyState
          compact
          kanji="列"
          title={t("admin.tasks.empty.title")}
          body={t("admin.tasks.empty.body")}
        />
      ) : (
        <ul className="space-y-2.5">
          {shown.map((s) => (
            <TaskRow key={s.id} scan={s} t={t} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TaskRow({ scan, t }) {
  const retry = useRetryScan();
  const fail = useFailScan();
  const del = useDeleteScan();
  const [confirmDel, setConfirmDel] = useState(false);

  const tone = STATE_TONE[scan.state] ?? OR;
  const terminal = scan.state === "ready" || scan.state === "failed";
  const active = scan.state === "pending" || scan.state === "processing";
  const busy = retry.isPending || fail.isPending || del.isPending;
  const exec = terminal ? execTime(scan.claimed_at, scan.finished_at) : null;

  return (
    <li
      className="p-3.5"
      style={{
        border: "1px solid color-mix(in oklab, var(--color-or) 13%, transparent)",
        borderLeft: `2px solid ${tone}`,
        background: "color-mix(in oklab, var(--color-noir-soft) 50%, transparent)",
        opacity: scan.state === "ready" ? 0.97 : 1,
      }}
    >
      <div className="flex items-start gap-3 flex-wrap">
        <span
          className="shrink-0 inline-flex items-center gap-1.5 text-[9px] uppercase tracking-[0.14em] px-[0.6em] py-[0.3em] border mt-0.5"
          style={{ color: tone, borderColor: `color-mix(in oklab, ${tone} 50%, transparent)` }}
        >
          <span className="w-[6px] h-[6px] rounded-full" style={{ background: tone, boxShadow: `0 0 6px ${tone}` }} />
          {t(`admin.tasks.status.${scan.state}`)}
        </span>

        <div className="flex-1 min-w-[14rem]">
          <div className="display text-[1.25rem] text-[var(--color-ivoire)] leading-tight">
            {t("admin.tasks.scan3d")} ·{" "}
            <Link
              to={`/figures/${scan.figure_slug}`}
              className="text-[var(--color-or-pale)] underline decoration-[var(--color-or)]/30 hover:decoration-[var(--color-or)] underline-offset-4"
            >
              {scan.figure_name}
            </Link>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono tracking-[0.03em] text-[var(--color-ivoire-soft)]">
            {scan.worker_name ? (
              <span style={{ color: INDIGO }}>⚙ {scan.worker_name}</span>
            ) : (
              <span className="opacity-55">{t("admin.tasks.no_worker")}</span>
            )}
            <span>{t("admin.tasks.updated", { rel: rel(scan.updated_at, t) })}</span>
            {exec ? <span style={{ color: "var(--color-or-pale)" }}>⏱ {t("admin.tasks.exec", { d: exec })}</span> : null}
            {scan.attempts > 1 ? <span>{t("admin.tasks.attempts", { n: scan.attempts })}</span> : null}
            <span className="opacity-55">@{scan.owner_username}</span>
          </div>

          {/* body: progress / error / result */}
          {scan.state === "processing" ? (
            <div className="mt-2.5 max-w-[360px]">
              <div className="relative h-[5px] overflow-hidden" style={{ background: `color-mix(in oklab, var(--color-indigo) 16%, transparent)` }}>
                <i className="absolute inset-y-0 left-0 not-italic" style={{ width: `${clampPct(scan.progress)}%`, background: INDIGO }} />
              </div>
              <span className="font-mono text-[10px] mt-1 block" style={{ color: INDIGO }}>
                {t("admin.tasks.progress", { pct: clampPct(scan.progress) })}
              </span>
            </div>
          ) : scan.state === "failed" && scan.error_message ? (
            <p
              className="mt-2 text-[11px] font-mono max-w-[560px] px-2.5 py-1.5"
              style={{ color: LAQUE, background: "var(--color-noir-deep)", borderLeft: `2px solid color-mix(in oklab, ${LAQUE} 55%, transparent)` }}
            >
              {scan.error_message}
            </p>
          ) : scan.state === "ready" ? (
            <p className="mt-2 text-[11.5px]" style={{ color: JADE }}>
              {t("admin.tasks.result.ready")}
            </p>
          ) : null}
        </div>

        {/* actions */}
        <div className="flex flex-col gap-1.5 items-stretch shrink-0">
          {scan.state === "failed" ? (
            <ActBtn tone={JADE} busy={busy} onClick={() => retry.mutate(scan.id)} label={`↻ ${t("admin.tasks.action.retry")}`} />
          ) : null}
          {active ? (
            <ActBtn tone={LAQUE} busy={busy} onClick={() => fail.mutate(scan.id)} label={t("admin.tasks.action.fail")} />
          ) : null}
          {terminal ? (
            confirmDel ? (
              <span className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => del.mutate(scan.id, { onSuccess: () => setConfirmDel(false) })}
                  disabled={del.isPending}
                  className="text-[10px] uppercase tracking-[0.12em] px-2.5 py-1.5 bg-[var(--color-laque)] text-[var(--color-ivoire)] disabled:opacity-60"
                >
                  {t("admin.tasks.delete.yes")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDel(false)}
                  className="text-[10px] uppercase tracking-[0.12em] px-2.5 py-1.5 border border-[color-mix(in_oklab,var(--color-or)_30%,transparent)] text-[var(--color-ivoire-soft)]"
                >
                  {t("admin.tasks.delete.no")}
                </button>
              </span>
            ) : (
              <ActBtn tone={OR} busy={busy} onClick={() => setConfirmDel(true)} label={t("admin.tasks.action.delete")} ghost />
            )
          ) : null}
        </div>
      </div>
    </li>
  );
}

function ActBtn({ tone, label, onClick, busy, ghost }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="text-[10px] uppercase tracking-[0.14em] px-2.5 py-1.5 border transition-colors disabled:opacity-50 whitespace-nowrap text-center"
      style={{
        color: ghost ? "var(--color-or-pale)" : tone,
        borderColor: `color-mix(in oklab, ${tone} ${ghost ? "30" : "55"}%, transparent)`,
      }}
    >
      {label}
    </button>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useT } from "../i18n/index.jsx";
import { appLocale } from "../lib/locale.js";
import {
  useAdminWorkers,
  useDeleteWorker,
  usePatchWorker,
} from "../hooks/useAdmin.js";
import AccentTitle from "../components/AccentTitle.jsx";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import StatCard from "../components/StatCard.jsx";
import EmptyState from "../components/EmptyState.jsx";

// ─────────────────────────────────────────────────────────────────────────────
// Direction-A status palette. Three real worker states map onto the redesign's
// status language (jade = healthy, gold = idle/attention, laque = down):
//   online (enabled + recent heartbeat) → jade   "en ligne"
//   paused (admin-disabled)             → gold   "en pause"
//   offline (stale heartbeat)           → laque  "hors-ligne"
// `busy` is the spec's gold "occupé" tone — surfaced only if the row carries a
// truthy `busy`/`active_job` flag; the fleet model exposes none today, so it
// degrades to the plain online dot.
// ─────────────────────────────────────────────────────────────────────────────

const JADE = "var(--color-jade)";
const OR = "var(--color-or)";
const LAQUE = "var(--color-laque-bright)";

function statusOf(w) {
  if (!w.enabled) return "paused";
  if (!w.online) return "offline";
  if (w.busy || w.active_job) return "busy";
  return "online";
}

const STATUS_TONE = {
  online: JADE,
  busy: OR,
  paused: OR,
  offline: LAQUE,
};

/**
 * 工 — admin curates the gsplat / compute worker fleet, redrawn to Direction A
 * ("Shōjo-Noir").
 *
 * Renders inside AdminLayout's <Outlet/>, beneath the global "Administration"
 * h1 + sub-nav, so this is an editorial *section* of the admin surface: an
 * editorial section head (kicker · 工 · FLOTTE → AccentTitle h2 → gold-rule →
 * italic gloss over a faint 工 watermark), a StatCard strip of fleet counts,
 * then each worker as a Direction-A Card row with a status chip + glowing dot
 * (jade healthy / gold idle / laque down). Ids, specs and metrics stay
 * monospaced; controls are hanko-red; the delete confirm is laque.
 *
 * Data + behaviour are unchanged: the single `useAdminWorkers` query (15 s
 * poll) drives the rows, `usePatchWorker` renames / toggles, `useDeleteWorker`
 * removes, and the local `deletionBlocked` gate still mirrors the backend rule.
 * GPU-light throughout — flat fills, hairlines, the shared `.reveal` stagger,
 * no meshes / blur / continuous animation.
 */
export default function AdminWorkersPage() {
  const t = useT();
  const workers = useAdminWorkers();

  const list = useMemo(() => workers.data ?? [], [workers.data]);
  // Fleet roll-up for the StatCard strip — derived from the same list, no
  // extra fetch. Counts only, so tones stay quiet (online → gold "value",
  // offline → hanko-red "loss"), per the playbook.
  const counts = useMemo(() => {
    const c = { total: list.length, online: 0, paused: 0, offline: 0 };
    for (const w of list) {
      const s = statusOf(w);
      if (s === "offline") c.offline++;
      else if (s === "paused") c.paused++;
      else c.online++; // online + busy both count as live
    }
    return c;
  }, [list]);

  return (
    <section className="relative">
      {/* ─── Editorial section head ─── */}
      <header className="relative mb-9">
        <span
          aria-hidden
          className="kanji-mark text-[16rem] -top-20 -right-4 hidden md:block select-none"
        >
          工
        </span>

        <p className="micro reveal flex items-center gap-2.5" style={{ "--i": 0 }}>
          <span aria-hidden className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45" />
          {t("admin.workers.eyebrow")}
          <span aria-hidden className="ja not-italic text-[var(--color-or)]">工</span>
          {t("admin.workers.kicker_label", { default: "FLOTTE" })}
        </p>
        <h2
          className="display text-4xl md:text-5xl mt-3 text-[var(--color-ivoire)] leading-[0.95] reveal"
          style={{ "--i": 1 }}
        >
          <AccentTitle text={t("admin.tab.workers")} />
        </h2>
        <div className="gold-rule w-16 mt-5 reveal" style={{ "--i": 2 }} />
        <p
          className="mt-4 text-[var(--color-ivoire-soft)] leading-relaxed max-w-2xl reveal"
          style={{ "--i": 3 }}
        >
          {t("admin.workers.body")}
        </p>
      </header>

      {/* ─── Fleet counters strip ─── */}
      {!workers.isLoading && !workers.isError && list.length > 0 ? (
        <section
          className="reveal mb-10"
          style={{ "--i": 4 }}
          aria-label={t("admin.workers.fleet", { default: "Compteurs de la flotte" })}
        >
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              label={t("admin.workers.stat.total", { default: "Workers" })}
              value={counts.total}
              sub={t("admin.workers.count", { n: counts.total })}
            />
            <StatCard
              label={t("admin.workers.status.online")}
              value={counts.online}
              tone="gold"
            />
            <StatCard
              label={t("admin.workers.status.paused")}
              value={counts.paused}
            />
            <StatCard
              label={t("admin.workers.status.offline")}
              value={counts.offline}
              tone="red"
            />
          </div>
        </section>
      ) : null}

      {/* ─── Worker rows ─── */}
      {workers.isLoading ? (
        <p
          role="status"
          aria-live="polite"
          className="text-center text-[var(--color-ivoire-soft)] py-12"
        >
          …
        </p>
      ) : workers.isError ? (
        <p role="alert" className="text-center text-[var(--color-laque-bright)] py-12">
          {t("error.unknown")}
        </p>
      ) : list.length === 0 ? (
        <EmptyState
          kanji="工"
          eyebrow={t("admin.workers.eyebrow")}
          title={t("admin.workers.empty")}
          body={t("admin.workers.empty_hint")}
        />
      ) : (
        <ol className="space-y-3 reveal" style={{ "--i": 5 }}>
          {list.map((w) => (
            <li key={w.id}>
              <Row w={w} t={t} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row — a Direction-A Card with a status-tinted left spine, an inline-editable
// display name, a kind chip, a mono identity line, the spec grid, and the
// enable / delete controls. All mutation + gating logic is unchanged.
// ─────────────────────────────────────────────────────────────────────────────

function Row({ w, t }) {
  const [editingName, setEditingName] = useState(false);
  const patch = usePatchWorker();
  const del = useDeleteWorker();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Computed deletion gate: backend rejects delete when enabled AND online,
  // but we mirror that locally so the button is greyed before the click.
  const deletionBlocked = w.enabled && w.online;

  const toggleEnabled = async () => {
    await patch.mutateAsync({ id: w.id, patch: { enabled: !w.enabled } });
  };

  const onDelete = async () => {
    await del.mutateAsync(w.id);
    // Row will be removed by the refetch from the mutation's onSuccess.
  };

  const tone = STATUS_TONE[statusOf(w)];

  return (
    <Card as="article" className="relative overflow-hidden">
      {/* Status-tinted left spine — jade healthy / gold idle / laque down. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[2px]"
        style={{ background: tone }}
      />
      {/* Faint 工 seal bleeding off the top-right corner. */}
      <span
        aria-hidden
        className="kanji-mark text-[7rem] -top-6 -right-2 select-none"
      >
        工
      </span>

      <div className="relative p-5 md:p-6">
        <div className="flex items-start gap-4 flex-wrap md:flex-nowrap">
          {/* Identity column */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <StatusChip w={w} t={t} />
              {editingName ? (
                <DisplayNameEdit w={w} onClose={() => setEditingName(false)} />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingName(true)}
                  className="tap-target display text-xl text-[var(--color-ivoire)] hover:text-[var(--color-or)] transition-colors text-left leading-tight"
                  title={t("admin.workers.rename")}
                >
                  {w.effective_name}
                  <span aria-hidden className="ml-2 text-[11px] opacity-50">
                    ✎
                  </span>
                  <span className="sr-only">{t("admin.workers.rename")}</span>
                </button>
              )}
              <KindBadge kind={w.kind} />
            </div>

            {/* Identity strip — hostname + last-seen, monospaced. */}
            <div className="mt-2 text-[11px] font-mono tracking-[0.03em] text-[var(--color-ivoire-soft)]/80">
              <span className="text-[var(--color-or-pale)]">{w.hostname}</span>
              {w.display_name && w.display_name !== w.hostname
                ? ` · ${w.display_name}`
                : null}
              <span className="opacity-40"> · </span>
              <span title={new Date(w.last_seen).toLocaleString(appLocale())}>
                {t("admin.workers.last_seen")} {relativeTime(w.last_seen, t)}
              </span>
            </div>

            <dl className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-x-5 gap-y-2 text-[11px]">
              <Spec label={t("admin.workers.spec.os")} value={w.os} mono />
              <Spec label={t("admin.workers.spec.arch")} value={w.arch} mono />
              <Spec label={t("admin.workers.spec.gpu")} value={w.gpu} />
              <Spec
                label={t("admin.workers.spec.vram")}
                value={w.gpu_memory_mb ? `${w.gpu_memory_mb} MB` : null}
                mono
              />
              <Spec
                label={t("admin.workers.spec.runtime")}
                value={w.runtime_version}
              />
              <Spec
                label={t("admin.workers.spec.version")}
                value={w.worker_version}
                mono
              />
              <Spec
                label={t("admin.workers.spec.heartbeat")}
                value={`${w.heartbeat_interval_secs}s`}
                mono
              />
              <Spec
                label={t("admin.workers.spec.registered")}
                value={new Date(w.registered_at).toLocaleDateString(appLocale())}
                mono
              />
            </dl>
          </div>

          {/* Controls column — enable toggle + delete (hanko-red). */}
          <div className="flex items-center gap-2 shrink-0 md:flex-col md:items-stretch">
            <button
              type="button"
              onClick={toggleEnabled}
              disabled={patch.isPending}
              aria-pressed={w.enabled}
              className="tap-target text-[10px] uppercase tracking-[0.16em] px-3 py-2 border transition-colors disabled:opacity-50 disabled:cursor-wait whitespace-nowrap text-center"
              style={
                w.enabled
                  ? {
                      color: JADE,
                      borderColor: `color-mix(in oklab, ${JADE} 50%, transparent)`,
                    }
                  : {
                      color: "var(--color-ivoire-soft)",
                      borderColor:
                        "color-mix(in oklab, var(--color-or) 28%, transparent)",
                    }
              }
              title={
                w.enabled
                  ? t("admin.workers.disable")
                  : t("admin.workers.enable")
              }
            >
              <span aria-hidden>{w.enabled ? "● " : "○ "}</span>
              {w.enabled
                ? t("admin.workers.enabled")
                : t("admin.workers.disabled")}
            </button>

            {confirmingDelete ? (
              <span className="inline-flex items-center gap-1.5">
                <Button
                  variant="danger"
                  size="sm"
                  onClick={onDelete}
                  disabled={del.isPending}
                  loading={del.isPending}
                >
                  {t("admin.workers.delete_yes")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={del.isPending}
                >
                  {t("admin.workers.delete_no")}
                </Button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                disabled={deletionBlocked || del.isPending}
                title={
                  deletionBlocked
                    ? t("admin.workers.delete_blocked")
                    : t("admin.workers.delete")
                }
                className="tap-target text-[10px] uppercase tracking-[0.16em] px-3 py-2 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap text-center"
                style={
                  deletionBlocked
                    ? {
                        color: "var(--color-ivoire-soft)",
                        borderColor:
                          "color-mix(in oklab, var(--color-or) 22%, transparent)",
                      }
                    : {
                        color: LAQUE,
                        borderColor: `color-mix(in oklab, ${LAQUE} 50%, transparent)`,
                      }
                }
              >
                <span aria-hidden>× </span>
                {t("admin.workers.delete")}
              </button>
            )}
          </div>
        </div>

        {patch.isError || del.isError ? (
          <p
            role="alert"
            className="mt-4 text-xs font-mono text-[var(--color-laque-bright)] px-3 py-1.5"
            style={{
              borderLeft: `2px solid color-mix(in oklab, ${LAQUE} 55%, transparent)`,
              background: "var(--color-noir-deep)",
            }}
          >
            {(patch.error || del.error)?.message}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function DisplayNameEdit({ w, onClose }) {
  const [value, setValue] = useState(w.display_name ?? "");
  const patch = usePatchWorker();

  useEffect(() => {
    setValue(w.display_name ?? "");
  }, [w.display_name, w.id]);

  const submit = async (e) => {
    e.preventDefault();
    const trimmed = value.trim();
    // Empty string clears the override (display_name → null, falls back to
    // hostname). Send `Some(None)` via { display_name: null }.
    await patch.mutateAsync({
      id: w.id,
      patch: { display_name: trimmed === "" ? null : trimmed },
    });
    onClose();
  };

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
        placeholder={w.hostname}
        aria-label={w.effective_name}
        className="min-w-48 bg-[var(--color-noir-deep)] border border-[var(--color-or)]/40 px-2.5 py-1.5 text-sm font-mono text-[var(--color-ivoire)] focus:outline-none focus:border-[var(--color-or)]"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <Button type="submit" variant="primary" loading={patch.isPending}>
        ✓
      </Button>
      <Button
        type="button"
        variant="ghost"
        onClick={onClose}
        disabled={patch.isPending}
      >
        ×
      </Button>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bits
// ─────────────────────────────────────────────────────────────────────────────

function StatusChip({ w, t }) {
  // Four visible states (busy degrades to online when the row carries no
  // activity flag):
  //   online  — enabled AND last_seen recent          (jade)
  //   busy    — online AND an active job              (gold)
  //   offline — last_seen stale (regardless of state) (laque)
  //   paused  — enabled but admin disabled it         (gold)
  const status = statusOf(w);
  const tone = STATUS_TONE[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] border px-2 py-0.5"
      style={{
        color: tone,
        borderColor: `color-mix(in oklab, ${tone} 50%, transparent)`,
        background: `color-mix(in oklab, ${tone} 9%, transparent)`,
      }}
    >
      <span
        aria-hidden
        className="w-[6px] h-[6px] rounded-full shrink-0"
        style={{
          background: status === "paused" ? "transparent" : tone,
          border: status === "paused" ? `1px solid ${tone}` : "none",
          boxShadow:
            status === "offline" || status === "paused"
              ? "none"
              : `0 0 6px ${tone}`,
        }}
      />
      <span>
        {status === "busy"
          ? t("admin.workers.status.busy", { default: "Occupé" })
          : t(`admin.workers.status.${status}`)}
      </span>
    </span>
  );
}

function KindBadge({ kind }) {
  const label = kind === "cuda" ? "CUDA" : kind === "metal" ? "METAL" : kind;
  return (
    <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--color-or-pale)] border border-[var(--color-or)]/30 px-2 py-0.5">
      {label}
    </span>
  );
}

function Spec({ label, value, mono }) {
  return (
    <div className="flex flex-col min-w-0">
      <dt className="label-mono text-[var(--color-ivoire-soft)]/65">{label}</dt>
      <dd
        className={`truncate ${mono ? "font-mono" : ""} text-[var(--color-ivoire)] ${
          value ? "" : "opacity-40"
        }`}
        title={value || "—"}
      >
        {value || "—"}
      </dd>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Relative time — "il y a 2 min" / "2 min ago". Self-contained: avoids a
// dependency on dayjs/date-fns just for this page.
// ─────────────────────────────────────────────────────────────────────────────

function relativeTime(iso, t) {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return t("admin.workers.time.just_now");
  const s = Math.floor(ms / 1000);
  if (s < 30) return t("admin.workers.time.just_now");
  if (s < 60) return t("admin.workers.time.seconds_ago", { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t("admin.workers.time.minutes_ago", { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("admin.workers.time.hours_ago", { n: h });
  const d = Math.floor(h / 24);
  return t("admin.workers.time.days_ago", { n: d });
}

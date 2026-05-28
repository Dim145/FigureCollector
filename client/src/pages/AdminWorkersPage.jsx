import { useEffect, useState } from "react";
import { useT } from "../i18n/index.jsx";
import {
  useAdminWorkers,
  useDeleteWorker,
  usePatchWorker,
} from "../hooks/useAdmin.js";
import Button from "../components/Button.jsx";

/**
 * Admin curates the gsplat-worker fleet.
 *
 * Each row is a single worker — its identity (display name + hostname), its
 * kind (CUDA / Metal), its hardware specs, and its liveness state. The admin
 * can rename, enable/disable, or delete a worker. The list refetches every
 * 15 s so the live/offline indicator stays close to real-time without polling
 * hard.
 *
 * Visual direction: same "register of categories" ledger as the figure-types
 * page — gold spine, kanji seal in the gutter (機 = "machine"), inline edit
 * for the display name. The status pill on the left replaces the spine bullet
 * so the eye lands on online/offline first.
 */
export default function AdminWorkersPage() {
  const t = useT();
  const workers = useAdminWorkers();

  return (
    <section className="space-y-8">
      <header className="relative">
        <span
          aria-hidden
          className="ja absolute -top-6 -right-2 text-[10rem] leading-none text-[var(--color-or)]/[0.06] select-none pointer-events-none hidden md:block"
        >
          機
        </span>
        <p className="micro">{t("admin.workers.eyebrow")}</p>
        <h2 className="display text-3xl md:text-4xl text-[var(--color-ivoire)] mt-2">
          {t("admin.workers.title")}
        </h2>
        <div className="gold-rule w-16 mt-4" />
        <p className="mt-5 text-[var(--color-ivoire-soft)] leading-relaxed max-w-2xl">
          {t("admin.workers.body")}
        </p>

        <p className="micro-tight mt-7">
          {workers.data
            ? t("admin.workers.count", { n: workers.data.length })
            : "—"}
        </p>
      </header>

      {workers.isLoading ? (
        <p className="text-center text-[var(--color-ivoire-soft)] py-12">…</p>
      ) : !workers.data || workers.data.length === 0 ? (
        <EmptyState t={t} />
      ) : (
        <ol className="relative ml-3 border-l border-[var(--color-or)]/25 space-y-0">
          {workers.data.map((w) => (
            <li key={w.id} className="relative pl-8 pb-5 last:pb-0">
              <Row w={w} t={t} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row — info + status + actions; inline edit for display_name
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

  return (
    <article className="worker-row">
      {/* Kanji seal in the gutter (overlaps the gold spine). */}
      <span aria-hidden className="worker-row-seal">機</span>

      <div className="worker-row-body">
        <div className="flex items-center gap-3 flex-wrap">
          <StatusPill w={w} t={t} />
          {editingName ? (
            <DisplayNameEdit
              w={w}
              onClose={() => setEditingName(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingName(true)}
              className="display text-lg text-[var(--color-ivoire)] hover:text-[var(--color-or)] transition-colors text-left"
              title={t("admin.workers.rename")}
            >
              {w.effective_name}
              <span className="ml-2 text-[10px] opacity-50">✎</span>
            </button>
          )}
          <KindBadge kind={w.kind} />
        </div>

        {/* Identity strip — hostname + last-seen. Smaller, monospaced. */}
        <div className="mt-1.5 text-[11px] font-mono text-[var(--color-ivoire-soft)] opacity-80">
          {w.hostname}
          {w.display_name && w.display_name !== w.hostname
            ? ` · ${w.display_name}`
            : null}
          <span className="opacity-50"> · </span>
          <span title={new Date(w.last_seen).toLocaleString()}>
            {t("admin.workers.last_seen")} {relativeTime(w.last_seen, t)}
          </span>
        </div>

        {/* Hardware specs grid */}
        <dl className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-[11px]">
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
            value={new Date(w.registered_at).toLocaleDateString()}
            mono
          />
        </dl>
      </div>

      <div className="worker-row-actions">
        <button
          type="button"
          onClick={toggleEnabled}
          disabled={patch.isPending}
          className={`worker-row-btn ${w.enabled ? "is-on" : "is-off"}`}
          title={
            w.enabled
              ? t("admin.workers.disable")
              : t("admin.workers.enable")
          }
        >
          {w.enabled
            ? `● ${t("admin.workers.enabled")}`
            : `○ ${t("admin.workers.disabled")}`}
        </button>

        {confirmingDelete ? (
          <span className="worker-row-confirm">
            <button
              type="button"
              onClick={onDelete}
              disabled={del.isPending}
              className="worker-row-confirm-yes"
            >
              {t("admin.workers.delete_yes")}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              disabled={del.isPending}
              className="worker-row-confirm-no"
            >
              {t("admin.workers.delete_no")}
            </button>
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
            className={`worker-row-btn ${
              deletionBlocked ? "is-disabled" : "is-danger"
            }`}
          >
            × <span className="sr-only">{t("admin.workers.delete")}</span>
          </button>
        )}
      </div>

      {patch.isError || del.isError ? (
        <p
          role="alert"
          className="mt-3 text-xs text-[var(--color-laque-bright)] border-l-2 border-[var(--color-laque-bright)] pl-3 py-1"
        >
          {(patch.error || del.error)?.message}
        </p>
      ) : null}
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Display-name inline edit
// ─────────────────────────────────────────────────────────────────────────────

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
        className="bg-[var(--color-noir-deep)] border border-[var(--color-or)]/40 px-2 py-1 text-sm text-[var(--color-ivoire)] focus:outline-none focus:border-[var(--color-or)]"
        style={{ minWidth: "12rem" }}
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

function StatusPill({ w, t }) {
  // Three visible states:
  //   ● online  — enabled AND last_seen recent
  //   ● offline — last_seen stale (regardless of enabled)
  //   ○ paused  — enabled but admin disabled it
  const status = !w.enabled
    ? "paused"
    : w.online
      ? "online"
      : "offline";
  const styles = {
    online: "text-[var(--color-or)] border-[var(--color-or)]/50 bg-[var(--color-or)]/10",
    offline: "text-[var(--color-laque-bright)] border-[var(--color-laque-bright)]/50 bg-[var(--color-laque-bright)]/10",
    paused: "text-[var(--color-ivoire-soft)] border-[var(--color-ivoire-soft)]/40 bg-[var(--color-noir-soft)]/60",
  }[status];
  const dot = { online: "●", offline: "●", paused: "—" }[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.22em] border px-2 py-0.5 ${styles}`}
    >
      <span>{dot}</span>
      <span>{t(`admin.workers.status.${status}`)}</span>
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
      <dt className="text-[9px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)] opacity-70">
        {label}
      </dt>
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

function EmptyState({ t }) {
  return (
    <div className="text-center py-16">
      <p className="ja text-[6rem] text-[var(--color-or)]/30 leading-none">機</p>
      <p className="mt-3 text-[var(--color-ivoire-soft)] italic">
        {t("admin.workers.empty")}
      </p>
      <p className="mt-2 text-xs text-[var(--color-ivoire-soft)] opacity-70 max-w-md mx-auto">
        {t("admin.workers.empty_hint")}
      </p>
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

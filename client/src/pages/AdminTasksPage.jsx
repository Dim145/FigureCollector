import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import {
  useAdminScans,
  useRetryScan,
  useFailScan,
  useDeleteScan,
  useAdminJobs,
  useRetryJob,
  useAdminVisualSearchQueue,
  useAdminVisualSearchDuplicates,
} from "../hooks/useAdmin.js";
import StatCard from "../components/StatCard.jsx";
import EmptyState from "../components/EmptyState.jsx";
import { resolveFigureCover } from "../lib/coverUrl.js";

/**
 * /admin/tasks — every background task of the server, redrawn to Direction A
 * ("Shōjo-Noir"). Two sources merge into ONE chronological timeline:
 *
 *   - the gsplat compute queue (scans claimed by external workers), and
 *   - the server's own background jobs (release cron, scan cleanup, manga
 *     sync, price cron) recorded in `server_job_runs` — these show "Serveur"
 *     (司) where the worker name would be, plus their trigger (planifié /
 *     manuel), their result summary, and a retry control on failures.
 *
 * Renders inside AdminLayout's <Outlet/>, under the global "Administration" h1 +
 * the 務 nav marker, so this view is an editorial *section* of the admin surface
 * (kicker · 務 · label → AccentTitle-style h2 → gold-rule → italic gloss over a
 * faint 務 watermark), not a second page header.
 *
 * The queue itself is a refined A timeline: jobs thread down a single gold spine,
 * each stamped with a status chip toned per the playbook — jade for done, gold
 * for running, laque for failed, ivoire for queued. Ids, workers, timings and
 * progress read in mono; retry/cancel controls are hanko-red. Job runs reuse the
 * exact same row anatomy (spine node, chip, mono meta, error well) so an admin
 * can't tell which rows came first. GPU-light throughout — flat fills,
 * hairlines, the shared `.reveal` stagger; no meshes / blur / animation.
 */

// Status → accent token (STYLING ONLY). Per the Direction-A playbook the queue
// chips read: jade = done (ready), gold = running (processing), laque = failed,
// ivoire = queued (pending). Every value is a theme CSS var so the palette flips
// with the light/dark theme.
const JADE = "var(--color-jade)";
const OR = "var(--color-or)";
const LAQUE = "var(--color-laque-bright)";
const IVOIRE = "var(--color-ivoire)";

const STATE_TONE = {
  pending: IVOIRE,
  processing: OR,
  ready: JADE,
  failed: LAQUE,
};

// Kanji marker per lifecycle slot — echoes the seal language of the Horarium
// (PreordersPage) so the admin surface reads in the same hand.
//   待 wait · 動 move/run · 済 settled/done · 否 deny/fail.
const STATE_KANJI = {
  pending: "待",
  processing: "動",
  ready: "済",
  failed: "否",
};

const FILTERS = {
  all: () => true,
  active: (s) => s === "pending" || s === "processing",
  failed: (s) => s === "failed",
  ready: (s) => s === "ready",
};

const FILTER_TONE = {
  all: OR,
  active: OR,
  failed: LAQUE,
  ready: JADE,
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
 * The visual-search indexing job — a queue of many tiny per-image embeds, so it
 * reads as ONE aggregate panel (progress + state breakdown) rather than flooding
 * the timeline with thousands of rows. Polls live like the scan/job feeds; hides
 * itself entirely until indexing has happened (nothing queued, nothing indexed).
 */
/**
 * "Doublons potentiels" — catalogue figures the DINOv2 index flags as visually
 * near-identical (same piece listed twice, or a re-release). A read-only review
 * aid: each pair links to both figures so the admin can compare + merge/delete
 * manually. Self-hides when nothing is flagged. NSFW shown un-blurred on
 * purpose (admin needs to compare; the panel is require_admin-gated).
 */
function DuplicatesPanel({ t }) {
  const dupes = useAdminVisualSearchDuplicates();
  const pairs = dupes.data ?? [];
  if (dupes.isPending || dupes.isError || pairs.length === 0) return null;

  return (
    <section
      className="reveal mt-8"
      style={{ "--i": 5 }}
      aria-label={t("admin.tasks.dupes.title", { default: "Doublons potentiels" })}
    >
      <div
        className="relative p-4 sm:p-5"
        style={{
          border: "1px solid color-mix(in oklab, var(--color-or) 14%, transparent)",
          borderLeft: `2px solid ${LAQUE}`,
          background: "color-mix(in oklab, var(--color-noir-soft) 50%, transparent)",
        }}
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="micro flex items-center gap-2">
              <span aria-hidden className="ja not-italic text-[var(--color-or)]">重</span>
              {t("admin.tasks.dupes.eyebrow", { default: "Intégrité du catalogue" })}
            </p>
            <h3 className="display text-xl text-[var(--color-ivoire)] mt-1 leading-tight">
              {t("admin.tasks.dupes.title", { default: "Doublons potentiels" })}
            </h3>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ivoire-soft)] mt-0.5">
            {t("admin.tasks.dupes.count", { n: pairs.length, default: `${pairs.length} paire(s)` })}
          </span>
        </div>
        <p className="mt-2 text-[12px] text-[var(--color-ivoire-soft)]/70">
          {t("admin.tasks.dupes.hint", {
            default:
              "Paires visuellement quasi identiques — vérifie, puis fusionne ou supprime la pièce en double.",
          })}
        </p>
        <ul className="mt-4 space-y-2.5">
          {pairs.map((p) => (
            <FigurePairRow key={`${p.a.id}-${p.b.id}`} pair={p} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function FigurePairRow({ pair }) {
  const { a, b, distance } = pair;
  const sim = Math.max(0, Math.min(100, Math.round((1 - distance) * 100)));
  return (
    <li
      className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 p-2.5"
      style={{
        border: "1px solid color-mix(in oklab, var(--color-or) 10%, transparent)",
        background: "color-mix(in oklab, var(--color-noir) 40%, transparent)",
      }}
    >
      <DupeFigure fig={a} align="right" />
      <span
        className="font-mono text-[11px] px-2 py-0.5 whitespace-nowrap"
        style={{ color: OR, border: `1px solid color-mix(in oklab, ${OR} 30%, transparent)` }}
        title={`distance ${distance.toFixed(3)}`}
      >
        {sim}%
      </span>
      <DupeFigure fig={b} align="left" />
    </li>
  );
}

function DupeFigure({ fig, align }) {
  return (
    <Link
      to={`/figures/${fig.id}`}
      className={`group flex items-center gap-2.5 min-w-0 ${
        align === "right" ? "flex-row-reverse text-right" : ""
      }`}
    >
      <img
        src={resolveFigureCover(fig)}
        alt=""
        loading="lazy"
        className="w-12 h-14 object-cover shrink-0 border border-[color-mix(in_oklab,var(--color-or)_15%,transparent)]"
      />
      <span className="min-w-0">
        <span className="block truncate text-[13px] text-[var(--color-ivoire)] group-hover:text-[var(--color-or)] transition-colors">
          {fig.name}
        </span>
        <span className="block truncate text-[11px] text-[var(--color-ivoire-soft)]/55 font-mono">
          {fig.manufacturer_name ?? fig.id.slice(0, 8)}
        </span>
      </span>
    </Link>
  );
}

export default function AdminTasksPage() {
  const t = useT();
  const q = useAdminScans();
  const jobsQ = useAdminJobs();
  // Live embed-queue stats — drives the worker strip and the live progress shown
  // inside in-flight reindex history rows (indexing now lives in the timeline).
  const queue = useAdminVisualSearchQueue();
  const indexQueues = queue.data?.indexes ?? [];
  const workerPresent = queue.data?.worker_present;
  const [filter, setFilter] = useState("all");

  // Merge worker scans + server job runs into one chronological timeline.
  // Both share the state vocabulary, so counts/filters apply uniformly; the
  // sort key is each row's latest activity (scan update vs job finish/start).
  // (Also satisfies the branch's memoisation fix — `rows` is referentially
  // stable for the `counts` memo below.)
  const rows = useMemo(() => {
    const scans = (q.data ?? []).map((s) => ({
      kind: "scan",
      key: `scan-${s.id}`,
      state: s.state,
      at: s.updated_at,
      scan: s,
    }));
    const jobs = (jobsQ.data ?? []).map((j) => ({
      kind: "job",
      key: `job-${j.id}`,
      state: j.state,
      at: j.finished_at ?? j.started_at,
      job: j,
    }));
    return [...scans, ...jobs].sort(
      (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
    );
  }, [q.data, jobsQ.data]);

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

  // Queue counters → Direction-A StatCard strip. Active leans hanko-red (work in
  // flight = the time-sensitive figure), failures stay ivoire here but the
  // filter chip + rows carry the laque alarm; done is the quiet gold tally.
  const stats = [
    { key: "all", label: t("admin.tasks.stat.total", { default: "File" }), value: counts.all },
    { key: "active", label: t("admin.tasks.stat.active", { default: "En cours" }), value: counts.active, tone: "red" },
    { key: "failed", label: t("admin.tasks.stat.failed", { default: "Échecs" }), value: counts.failed },
    { key: "ready", label: t("admin.tasks.stat.ready", { default: "Réussies" }), value: counts.ready, tone: "gold" },
  ];

  return (
    <div className="relative">
      {/* ─── Editorial section header ─── */}
      <header className="relative mb-9">
        <span
          aria-hidden
          className="kanji-mark text-[16rem] -top-20 -right-4 hidden md:block select-none"
        >
          務
        </span>

        <p className="micro reveal flex items-center gap-2.5" style={{ "--i": 0 }}>
          <span aria-hidden className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45" />
          {t("admin.subtitle")}
          <span aria-hidden className="ja not-italic text-[var(--color-or)]">務</span>
          {t("admin.tasks.kicker_label", { default: "FILE DE CALCUL" })}
        </p>
        <h2
          className="display text-4xl md:text-5xl mt-3 text-[var(--color-ivoire)] leading-[0.95] reveal"
          style={{ "--i": 1 }}
        >
          {/* Inline AccentTitle: leading word in hanko-red italic, per the
              playbook signature. Inlined (not <AccentTitle>) so the live count
              of in-flight jobs can ride alongside the headline as a mono tag. */}
          <span className="italic text-[var(--color-laque-bright)]">
            {t("admin.tasks.title_accent", { default: "File" })}
          </span>{" "}
          {t("admin.tasks.title_rest", { default: "de tâches" })}
        </h2>
        <div className="gold-rule w-24 mt-5 reveal" style={{ "--i": 2 }} />
        <p
          className="mt-4 text-[var(--color-ivoire-soft)] leading-relaxed max-w-2xl reveal"
          style={{ "--i": 3 }}
        >
          {t("admin.tasks.body")}
        </p>
      </header>

      {/* ─── Live: embed-worker presence. Indexing runs now appear as rows in
            the timeline below (with live progress while in flight). ─── */}
      {queue.data ? (
        <div
          className="reveal mb-6 inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.14em] px-3 py-1.5 border"
          style={{
            "--i": 3,
            color: workerPresent ? JADE : "var(--color-ivoire-soft)",
            borderColor: `color-mix(in oklab, ${workerPresent ? JADE : "var(--color-ivoire-soft)"} 35%, transparent)`,
            background: workerPresent ? `color-mix(in oklab, ${JADE} 7%, transparent)` : "transparent",
          }}
        >
          <span
            aria-hidden
            className="w-1.5 h-1.5 rotate-45"
            style={{
              background: workerPresent
                ? JADE
                : "color-mix(in oklab, var(--color-ivoire-soft) 50%, transparent)",
            }}
          />
          {t("admin.tasks.indexing.worker_label", { default: "Worker d'indexation" })}
          {" · "}
          {workerPresent
            ? t("admin.tasks.indexing.worker_on", { default: "Worker en ligne" })
            : t("admin.tasks.indexing.worker_off", { default: "Aucun worker" })}
        </div>
      ) : null}

      {/* ─── Queue counters strip ─── */}
      <section
        className="reveal"
        style={{ "--i": 4 }}
        aria-label={t("admin.tasks.stat.region", { default: "Compteurs de la file" })}
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {stats.map((s) => (
            <StatCard key={s.key} label={s.label} value={s.value} tone={s.tone} />
          ))}
        </div>
      </section>

      {/* ─── Filter rail + auto-cleanup note ─── */}
      <div
        className="mt-8 flex items-center gap-3 flex-wrap reveal"
        style={{ "--i": 5 }}
      >
        <nav
          className="flex gap-1.5 flex-wrap"
          aria-label={t("admin.tasks.filter.region", { default: "Filtrer la file" })}
        >
          {["all", "active", "failed", "ready"].map((f) => {
            const on = filter === f;
            const tone = FILTER_TONE[f];
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                aria-pressed={on}
                className="tap-target inline-flex items-center text-[10px] uppercase tracking-[0.18em] px-3 py-1.5 border transition-colors"
                style={
                  on
                    ? {
                        color: tone,
                        borderColor: `color-mix(in oklab, ${tone} 60%, transparent)`,
                        background: `color-mix(in oklab, ${tone} 10%, transparent)`,
                      }
                    : {
                        color: "var(--color-ivoire-soft)",
                        borderColor: "color-mix(in oklab, var(--color-or) 22%, transparent)",
                      }
                }
              >
                {t(`admin.tasks.filter.${f}`)}
                {counts[f] > 0 ? (
                  <span
                    className="ml-2 font-mono text-[9px] tabular-nums"
                    style={{ color: on ? tone : "var(--color-or-pale)", opacity: on ? 1 : 0.7 }}
                  >
                    {counts[f]}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
        <span className="flex-1" />
        <p className="micro-tight flex items-center gap-2 text-[var(--color-ivoire-soft)]/70 normal-case tracking-[0.12em]">
          <span aria-hidden className="ja text-[var(--color-or)]/60 text-sm leading-none">掃</span>
          {t("admin.tasks.cleanup")}
        </p>
      </div>

      {/* ─── The queue ─── */}
      {q.isLoading || jobsQ.isLoading ? (
        <p
          role="status"
          aria-live="polite"
          className="text-center text-[var(--color-ivoire-soft)] py-12"
        >
          …
        </p>
      ) : shown.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            compact
            kanji="務"
            eyebrow={t("admin.tasks.kicker_label", { default: "FILE DE CALCUL" })}
            title={t("admin.tasks.empty.title")}
            body={t("admin.tasks.empty.body")}
          />
        </div>
      ) : (
        // The timeline: a single gold spine threads down the left, each job a
        // node along it. The spine is a static hairline gradient (~0 GPU).
        <ol
          className="mt-8 relative pl-7 sm:pl-9"
          style={{
            "--spine": "color-mix(in oklab, var(--color-or) 26%, transparent)",
          }}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute top-2 bottom-2 left-[7px] sm:left-[9px] w-px"
            style={{
              background:
                "linear-gradient(180deg, transparent, var(--spine) 8%, var(--spine) 92%, transparent)",
            }}
          />
          {shown.map((r, i) =>
            r.kind === "scan" ? (
              <TaskRow key={r.key} scan={r.scan} t={t} index={i} />
            ) : (
              <JobRow key={r.key} job={r.job} t={t} index={i} indexQueues={indexQueues} />
            ),
          )}
        </ol>
      )}

      {/* ─── Catalogue integrity (potential duplicates) — secondary section,
            self-hides when nothing is flagged ─── */}
      <DuplicatesPanel t={t} />
    </div>
  );
}

// =============================================================================
// TaskRow — one job node on the timeline. The status chip + a spine node carry
// the lifecycle accent; the body holds the figure link, mono meta line and the
// state-specific read-out (progress bar / error well / ready note); the right
// rail holds the hanko-red retry/cancel controls + the delete confirm gate.
// =============================================================================

function TaskRow({ scan, t, index = 0 }) {
  const retry = useRetryScan();
  const fail = useFailScan();
  const del = useDeleteScan();
  const [confirmDel, setConfirmDel] = useState(false);

  const tone = STATE_TONE[scan.state] ?? OR;
  const terminal = scan.state === "ready" || scan.state === "failed";
  const active = scan.state === "pending" || scan.state === "processing";
  const busy = retry.isPending || fail.isPending || del.isPending;
  const exec = terminal ? execTime(scan.claimed_at, scan.finished_at) : null;
  // Cap the reveal stagger so a long queue never leaves the tail waiting.
  const revealDelay = `${Math.min(index * 0.05, 0.3)}s`;

  return (
    <li
      className="group relative py-4 reveal"
      style={{ "--delay": revealDelay }}
    >
      {/* Spine node — a small diamond fused to the gold thread, toned to the
          job's lifecycle accent. Static (GPU-light); a faint accent ring marks
          the running job instead of an animation. Decorative + pointer-inert. */}
      <span
        aria-hidden
        className="absolute top-[1.45rem] -left-[1.4rem] sm:-left-[1.65rem] w-[9px] h-[9px] rotate-45"
        style={{
          background: tone,
          boxShadow:
            scan.state === "processing"
              ? `0 0 0 3px color-mix(in oklab, ${tone} 22%, transparent), 0 0 8px color-mix(in oklab, ${tone} 70%, transparent)`
              : `0 0 8px color-mix(in oklab, ${tone} 70%, transparent)`,
        }}
      />

      <div
        className="relative p-3.5 transition-colors"
        style={{
          border: "1px solid color-mix(in oklab, var(--color-or) 12%, transparent)",
          borderLeft: `2px solid ${tone}`,
          background: "color-mix(in oklab, var(--color-noir-soft) 50%, transparent)",
          opacity: scan.state === "ready" ? 0.97 : 1,
        }}
      >
        <div className="flex items-start gap-3 flex-wrap">
          <StatusChip state={scan.state} tone={tone} t={t} />

          <div className="flex-1 min-w-[14rem]">
            <h3 className="display text-[1.25rem] text-[var(--color-ivoire)] leading-tight">
              {t("admin.tasks.scan3d")} ·{" "}
              <Link
                to={`/figures/${scan.figure_id}`}
                className="text-[var(--color-or-pale)] underline decoration-[var(--color-or)]/30 hover:decoration-[var(--color-or)] underline-offset-4"
              >
                {scan.figure_name}
              </Link>
            </h3>

            {/* Mono meta line — worker, ids, timings. */}
            <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono tracking-[0.03em] text-[var(--color-ivoire-soft)]">
              {scan.worker_name ? (
                <div className="flex items-center gap-1" style={{ color: OR }}>
                  <dt className="sr-only">{t("admin.tasks.meta.worker", { default: "Worker" })}</dt>
                  <span aria-hidden className="ja not-italic text-[11px] leading-none">工</span>
                  <dd>{scan.worker_name}</dd>
                </div>
              ) : (
                <span className="opacity-55">{t("admin.tasks.no_worker")}</span>
              )}
              <div>
                <dt className="sr-only">{t("admin.tasks.meta.updated", { default: "Mis à jour" })}</dt>
                <dd>{t("admin.tasks.updated", { rel: rel(scan.updated_at, t) })}</dd>
              </div>
              {exec ? (
                <div style={{ color: "var(--color-or-pale)" }}>
                  <dt className="sr-only">{t("admin.tasks.meta.exec", { default: "Durée" })}</dt>
                  <dd>{t("admin.tasks.exec", { d: exec })}</dd>
                </div>
              ) : null}
              {scan.attempts > 1 ? (
                <div>
                  <dt className="sr-only">{t("admin.tasks.meta.attempts", { default: "Tentatives" })}</dt>
                  <dd>{t("admin.tasks.attempts", { n: scan.attempts })}</dd>
                </div>
              ) : null}
              <div className="opacity-55">
                <dt className="sr-only">{t("admin.tasks.meta.owner", { default: "Propriétaire" })}</dt>
                <dd>@{scan.owner_username}</dd>
              </div>
            </dl>

            {/* State-specific read-out: progress / error / result. */}
            {scan.state === "processing" ? (
              <div className="mt-2.5 max-w-[360px]">
                <div
                  className="relative h-[5px] overflow-hidden"
                  style={{ background: `color-mix(in oklab, ${OR} 14%, transparent)` }}
                >
                  <i
                    className="absolute inset-y-0 left-0 not-italic"
                    style={{ width: `${clampPct(scan.progress)}%`, background: OR }}
                  />
                </div>
                <span className="font-mono text-[10px] mt-1 block" style={{ color: OR }}>
                  {t("admin.tasks.progress", { pct: clampPct(scan.progress) })}
                </span>
              </div>
            ) : scan.state === "failed" && scan.error_message ? (
              <p
                className="mt-2 text-[11px] font-mono max-w-[560px] px-2.5 py-1.5"
                style={{
                  color: LAQUE,
                  background: "var(--color-noir-deep)",
                  borderLeft: `2px solid color-mix(in oklab, ${LAQUE} 55%, transparent)`,
                }}
              >
                {scan.error_message}
              </p>
            ) : scan.state === "ready" ? (
              <p className="mt-2 text-[11.5px]" style={{ color: JADE }}>
                {t("admin.tasks.result.ready")}
              </p>
            ) : null}
          </div>

          {/* Right rail — controls. Retry/fail are hanko-toned; delete is a
              gold ghost gated behind an inline confirm. */}
          <div className="flex flex-col gap-1.5 items-stretch shrink-0">
            {scan.state === "failed" ? (
              <ActBtn
                tone={JADE}
                busy={busy}
                onClick={() => retry.mutate(scan.id)}
                label={t("admin.tasks.action.retry")}
                glyph="↻"
              />
            ) : null}
            {active ? (
              <ActBtn
                tone={LAQUE}
                busy={busy}
                onClick={() => fail.mutate(scan.id)}
                label={t("admin.tasks.action.fail")}
              />
            ) : null}
            {terminal ? (
              confirmDel ? (
                <span className="inline-flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => del.mutate(scan.id, { onSuccess: () => setConfirmDel(false) })}
                    disabled={del.isPending}
                    className="tap-target text-[10px] uppercase tracking-[0.14em] px-3 py-1.5 bg-[var(--color-laque)] text-[var(--color-ivoire)] disabled:opacity-60"
                  >
                    {t("admin.tasks.delete.yes")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDel(false)}
                    className="tap-target text-[10px] uppercase tracking-[0.14em] px-3 py-1.5 border text-[var(--color-ivoire-soft)]"
                    style={{ borderColor: "color-mix(in oklab, var(--color-or) 30%, transparent)" }}
                  >
                    {t("admin.tasks.delete.no")}
                  </button>
                </span>
              ) : (
                <ActBtn
                  tone={OR}
                  busy={busy}
                  onClick={() => setConfirmDel(true)}
                  label={t("admin.tasks.action.delete")}
                  ghost
                />
              )
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

// =============================================================================
// JobRow — one server-job run on the same timeline. Identical row anatomy to
// TaskRow (spine node, status chip, mono meta, error well, hanko controls);
// the executor slot reads "Serveur" (司) instead of a worker name, a trigger
// tag says whether the schedule or an admin fired it, and a jade result line
// renders the run's JSON summary. Failed runs get the same retry control.
// =============================================================================

// server_job_runs.result keys with a localized "{n} …" label. Anything not
// listed renders as a raw `key: value` so new job summaries stay visible
// without a frontend release. `keep` is config (not an outcome) — skipped.
const RESULT_LABELLED = new Set([
  "processed",
  "updated",
  "filled",
  "purged",
  "release_today",
  "release_j7",
  "delivery_today",
  "delivery_overdue",
  "indexed",
  "failed",
  "queued",
]);
const RESULT_SKIP = new Set(["keep"]);

// Reindex job_name → the index kind(s) it covers, so a still-running reindex row
// can show live drain progress pulled from the embed-queue stats.
const REINDEX_KINDS = {
  reindex_image: ["image"],
  reindex_text: ["text"],
  reindex_look: ["look"],
  reindex_tags: ["tags"],
  reindex_all: ["image", "text", "look", "tags"],
};

/** "127 figurines traitées · 42 prix mis à jour" from a result JSON. Zero
 *  counts are dropped; an all-zero run reads "aucune action nécessaire". */
function formatJobResult(result, t) {
  if (!result || typeof result !== "object") return t("admin.tasks.result.nothing");
  const parts = [];
  for (const [k, v] of Object.entries(result)) {
    if (RESULT_SKIP.has(k)) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n === 0) continue;
    parts.push(
      RESULT_LABELLED.has(k) ? t(`admin.tasks.result.k.${k}`, { n }) : `${k}: ${n}`,
    );
  }
  return parts.length ? parts.join(" · ") : t("admin.tasks.result.nothing");
}

/** Live drain progress for an in-flight reindex job, read from the embed-queue
 *  stats. Falls back to the generic running note for non-reindex jobs (or before
 *  the queue stats have loaded). */
function ReindexProgress({ job, indexQueues, t }) {
  const kinds = REINDEX_KINDS[job.job_name];
  const stats = kinds
    ? kinds.map((k) => indexQueues.find((q) => q.index === k)).filter(Boolean)
    : [];
  if (!kinds || stats.length === 0) {
    return (
      <p className="mt-2 text-[11px] font-mono" style={{ color: OR }}>
        {t("admin.tasks.job_running")}
      </p>
    );
  }
  const done = stats.reduce((a, s) => a + (s.done ?? 0), 0);
  const total = stats.reduce(
    (a, s) => a + (s.pending ?? 0) + (s.processing ?? 0) + (s.done ?? 0) + (s.failed ?? 0),
    0,
  );
  const pct = total > 0 ? clampPct((done / total) * 100) : 0;
  return (
    <div className="mt-2 max-w-[420px]">
      <div
        className="relative h-[5px] overflow-hidden"
        style={{ background: `color-mix(in oklab, ${OR} 14%, transparent)` }}
      >
        <i
          className="absolute inset-y-0 left-0 not-italic transition-[width] duration-500"
          style={{ width: `${pct}%`, background: OR }}
        />
      </div>
      <p className="mt-1 text-[10px] font-mono" style={{ color: OR }}>
        {t("admin.tasks.indexing.progress", {
          done,
          total,
          pct,
          default: `${done} / ${total} · ${pct} %`,
        })}
      </p>
    </div>
  );
}

function JobRow({ job, t, index = 0, indexQueues = [] }) {
  const retry = useRetryJob();

  const tone = STATE_TONE[job.state] ?? OR;
  const exec = execTime(job.started_at, job.finished_at);
  const revealDelay = `${Math.min(index * 0.05, 0.3)}s`;

  return (
    <li className="group relative py-4 reveal" style={{ "--delay": revealDelay }}>
      {/* Spine node — same diamond as the scan rows, toned to the run state. */}
      <span
        aria-hidden
        className="absolute top-[1.45rem] -left-[1.4rem] sm:-left-[1.65rem] w-[9px] h-[9px] rotate-45"
        style={{
          background: tone,
          boxShadow:
            job.state === "processing"
              ? `0 0 0 3px color-mix(in oklab, ${tone} 22%, transparent), 0 0 8px color-mix(in oklab, ${tone} 70%, transparent)`
              : `0 0 8px color-mix(in oklab, ${tone} 70%, transparent)`,
        }}
      />

      <div
        className="relative p-3.5 transition-colors"
        style={{
          border: "1px solid color-mix(in oklab, var(--color-or) 12%, transparent)",
          borderLeft: `2px solid ${tone}`,
          background: "color-mix(in oklab, var(--color-noir-soft) 50%, transparent)",
          opacity: job.state === "ready" ? 0.97 : 1,
        }}
      >
        <div className="flex items-start gap-3 flex-wrap">
          <StatusChip state={job.state} tone={tone} t={t} />

          <div className="flex-1 min-w-[14rem]">
            <h3 className="display text-[1.25rem] text-[var(--color-ivoire)] leading-tight">
              {t(`admin.tasks.job.${job.job_name}`, { default: job.job_name })}
            </h3>

            {/* Mono meta line — executor (the server), trigger, timings. */}
            <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono tracking-[0.03em] text-[var(--color-ivoire-soft)]">
              <div className="flex items-center gap-1" style={{ color: OR }}>
                <dt className="sr-only">{t("admin.tasks.meta.worker", { default: "Worker" })}</dt>
                <span aria-hidden className="ja not-italic text-[11px] leading-none">司</span>
                <dd>{t("admin.tasks.server")}</dd>
              </div>
              <div>
                <dt className="sr-only">{t("admin.tasks.meta.trigger", { default: "Déclencheur" })}</dt>
                <dd>{t(`admin.tasks.trigger.${job.triggered_by}`, { default: job.triggered_by })}</dd>
              </div>
              <div>
                <dt className="sr-only">{t("admin.tasks.meta.updated", { default: "Mis à jour" })}</dt>
                <dd>{t("admin.tasks.started", { rel: rel(job.started_at, t) })}</dd>
              </div>
              {exec ? (
                <div style={{ color: "var(--color-or-pale)" }}>
                  <dt className="sr-only">{t("admin.tasks.meta.exec", { default: "Durée" })}</dt>
                  <dd>{t("admin.tasks.exec", { d: exec })}</dd>
                </div>
              ) : null}
            </dl>

            {/* State-specific read-out: running note / error / result. */}
            {job.state === "processing" ? (
              <ReindexProgress job={job} indexQueues={indexQueues} t={t} />
            ) : job.state === "failed" && job.error_message ? (
              <p
                className="mt-2 text-[11px] font-mono max-w-[560px] px-2.5 py-1.5"
                style={{
                  color: LAQUE,
                  background: "var(--color-noir-deep)",
                  borderLeft: `2px solid color-mix(in oklab, ${LAQUE} 55%, transparent)`,
                }}
              >
                {job.error_message}
              </p>
            ) : job.state === "ready" ? (
              <p className="mt-2 text-[11.5px]" style={{ color: JADE }}>
                ✓ {formatJobResult(job.result, t)}
              </p>
            ) : null}
          </div>

          {/* Right rail — relaunch a failed run (books a fresh manual run). */}
          {job.state === "failed" ? (
            <div className="flex flex-col gap-1.5 items-stretch shrink-0">
              <ActBtn
                tone={JADE}
                busy={retry.isPending}
                onClick={() => retry.mutate(job.id)}
                label={t("admin.tasks.action.retry")}
                glyph="↻"
              />
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

// Status chip — a stacked seal: a kanji glyph above a mono caps label, ringed in
// the lifecycle accent. Replaces the old single-line pill so the chip carries
// the same visual weight as the Horarium seals while staying compact.
function StatusChip({ state, tone, t }) {
  return (
    <span
      className="shrink-0 inline-flex flex-col items-center gap-0.5 px-2.5 py-1.5 border mt-0.5 text-center"
      style={{
        color: tone,
        borderColor: `color-mix(in oklab, ${tone} 45%, transparent)`,
        background: `color-mix(in oklab, ${tone} 8%, transparent)`,
      }}
    >
      <span aria-hidden className="ja not-italic text-base leading-none">
        {STATE_KANJI[state] ?? "務"}
      </span>
      <span className="text-[9px] uppercase tracking-[0.14em] leading-none whitespace-nowrap">
        {t(`admin.tasks.status.${state}`)}
      </span>
    </span>
  );
}

function ActBtn({ tone, label, onClick, busy, ghost, glyph }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="tap-target text-[10px] uppercase tracking-[0.14em] px-3 py-1.5 border transition-colors disabled:opacity-50 whitespace-nowrap text-center"
      style={{
        color: ghost ? "var(--color-or-pale)" : tone,
        borderColor: `color-mix(in oklab, ${tone} ${ghost ? "30" : "55"}%, transparent)`,
      }}
    >
      {glyph ? <span aria-hidden className="mr-1">{glyph}</span> : null}
      {label}
    </button>
  );
}

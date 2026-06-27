import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, Search } from "lucide-react";
import { useT } from "../i18n/index.jsx";
import {
  useAdminScans,
  useRetryScan,
  useFailScan,
  useDeleteScan,
  useAdminJobs,
  useRetryJob,
  useDeleteJob,
  useAdminOcrJobs,
  useDeleteOcrJob,
  useAdminServices,
  useAdminVisualSearchQueue,
  useAdminVisualSearchDuplicates,
} from "../hooks/useAdmin.js";
import usePersistedState from "../hooks/usePersistedState.js";
import Button from "../components/Button.jsx";
import EmptyState from "../components/EmptyState.jsx";
import { resolveFigureCover } from "../lib/coverUrl.js";
import AdminSectionHeader from "./admin/AdminSectionHeader.jsx";
import {
  Badge,
  DataTable,
  Drawer,
  IconButton,
  Input,
  SegmentedControl,
  Select,
  Switch,
  Tabs,
  Tooltip,
} from "../components/ui/index.js";
import {
  JADE,
  OR,
  LAQUE,
  STATE_TONE,
  STATE_KANJI,
  STATE_BADGE_TONE,
  clampPct,
  rel,
  durationMs,
  fmtDuration,
  formatJobResult,
  formatServiceDetail,
} from "./admin/taskFormat.js";

/**
 * /admin/tasks — the server's background work, redrawn to Direction A
 * ("Shōjo-Noir") as a data-dense MONITORING CONSOLE rather than a timeline.
 *
 * Three sources merge into ONE unified, client-filterable, sortable table:
 *   - the gsplat compute queue (scans claimed by external GPU workers),
 *   - the server's own background jobs (release cron, scan cleanup, manga sync,
 *     price cron, reindex…) recorded in `server_job_runs`, and
 *   - the document-OCR queue (invoice/justificatif parsing).
 *
 * A "Santé des services" strip above the table surfaces each long-running
 * service's heartbeat. The filter bar (every control persisted to localStorage)
 * narrows by source, lifecycle state, type, trigger, a no-op toggle, free text
 * and a time window — all applied client-side over the merged rows. A row click
 * opens a detail drawer with timings, the formatted result + raw JSON, an error
 * well and the relevant actions (relaunch / retry / fail / delete).
 *
 * GPU-light throughout — flat fills, hairlines, the shared `.reveal` stagger;
 * no meshes / blur / animation. Renders inside AdminLayout's <Outlet/> under the
 * global "Administration" h1, so this is an editorial *section* (h2 via
 * <AdminSectionHeader>), not a second page header.
 */

// "Depuis" window options → milliseconds (null = no bound / "Tout").
const SINCE_MS = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 604_800_000,
  all: null,
};

// status → accent token for the service-health pills, on the same lifecycle
// palette as the rows (running/ok → jade, idle → ivoire, error → laque).
function serviceTone(status) {
  if (status === "ok" || status === "running") return JADE;
  if (status === "error" || status === "disconnected") return LAQUE;
  return "var(--color-ivoire-soft)"; // idle / unknown
}

// A coarse wall-clock that advances every `period` ms. The current time is read
// only in effects (the mount seed + the interval), never during render, so the
// "Depuis" window stays accurate without tripping the React purity rule.
// `setNow` from useState is stable, so the effect needs only `period`. The
// lazy initialiser seeds the clock once (not re-run on render); the interval
// then advances it from inside the effect.
function useNowTick(period) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), period);
    return () => clearInterval(id);
  }, [period]);
  return now;
}

export default function AdminTasksPage() {
  const t = useT();

  // ─── Persisted filter state (every control survives a reload) ───
  const [autoRefresh, setAutoRefresh] = usePersistedState("admin.tasks.autoRefresh", true);
  const [source, setSource] = usePersistedState("admin.tasks.source", "all");
  const [stateTab, setStateTab] = usePersistedState("admin.tasks.state", "all");
  const [typeFilter, setTypeFilter] = usePersistedState("admin.tasks.type", "all");
  const [trigger, setTrigger] = usePersistedState("admin.tasks.trigger", "all");
  const [hideNoop, setHideNoop] = usePersistedState("admin.tasks.hideNoop", false);
  const [search, setSearch] = usePersistedState("admin.tasks.search", "");
  const [since, setSince] = usePersistedState("admin.tasks.since", "all");
  const [sort, setSort] = usePersistedState("admin.tasks.sort", { key: "started", dir: "desc" });

  // ─── Data ───
  // Auto-refresh gates the live poll: when off, each hook freezes its interval
  // (a fresh fetch on mount/focus still happens) and the manual refresh button
  // is the way to pull. When on, the hooks keep their 6–10 s cadence.
  const scansQ = useAdminScans({ poll: autoRefresh });
  const jobsQ = useAdminJobs({ hide_noop: hideNoop, limit: 500, poll: autoRefresh });
  const ocrQ = useAdminOcrJobs({ poll: autoRefresh });
  const servicesQ = useAdminServices({ poll: autoRefresh });
  // Live embed-queue stats — drives live reindex progress in the drawer.
  const queue = useAdminVisualSearchQueue({ poll: autoRefresh });
  const indexQueues = queue.data?.indexes ?? [];

  const refetchAll = () => {
    scansQ.refetch();
    jobsQ.refetch();
    ocrQ.refetch();
    servicesQ.refetch();
    queue.refetch();
  };

  const loading =
    scansQ.isLoading || jobsQ.isLoading || ocrQ.isLoading;

  // ─── Unified row model: jobs + scans + ocr → one shape ───
  const allRows = useMemo(() => {
    const jobs = (jobsQ.data?.items ?? []).map((j) => ({
      id: `job-${j.id}`,
      source: "server",
      type: j.job_name,
      typeLabel: t(`admin.tasks.job.${j.job_name}`, { default: j.job_name }),
      // The "Type" column reads the SOURCE (server / scan / ocr); "Tâche"
      // keeps the specific job label so the two columns never duplicate.
      sourceLabel: t("admin.tasks.source.server", { default: "Serveur" }),
      // Server jobs carry no figure — the job label IS the task name.
      name: t(`admin.tasks.job.${j.job_name}`, { default: j.job_name }),
      state: j.state,
      trigger: j.triggered_by,
      started: j.started_at,
      finished: j.finished_at,
      durationMs: durationMs(j.started_at, j.finished_at),
      changed: j.changed ?? null,
      resultText:
        j.state === "failed"
          ? j.error_message || t("admin.tasks.result.failed_generic", { default: "Échec" })
          : j.state === "ready"
            ? formatJobResult(j.result, t)
            : t("admin.tasks.job_running"),
      raw: j,
    }));

    const scans = (scansQ.data ?? []).map((s) => ({
      id: `scan-${s.id}`,
      source: "scan",
      type: "scan",
      typeLabel: t("admin.tasks.scan3d"),
      sourceLabel: t("admin.tasks.scan3d"),
      // The visible "task" name carries the figure for scans/ocr so search +
      // the table read naturally.
      name: s.figure_name,
      state: s.state,
      // Worker scans carry no schedule/manual trigger — leave it unset so the
      // Trigger facet skips them and the column reads "—".
      trigger: null,
      started: s.claimed_at ?? s.created_at,
      finished: s.finished_at,
      durationMs: durationMs(s.claimed_at, s.finished_at),
      changed: null,
      progress: s.progress,
      resultText:
        s.state === "failed"
          ? s.error_message || t("admin.tasks.result.failed_generic", { default: "Échec" })
          : s.state === "ready"
            ? t("admin.tasks.result.ready")
            : s.state === "processing"
              ? t("admin.tasks.progress", { pct: clampPct(s.progress) })
              : t("admin.tasks.status.pending"),
      raw: s,
    }));

    const ocr = (ocrQ.data ?? []).map((o) => ({
      id: `ocr-${o.id}`,
      source: "ocr",
      type: "ocr",
      typeLabel: t("admin.tasks.ocr", { default: "OCR document" }),
      sourceLabel: t("admin.tasks.source.ocr", { default: "OCR" }),
      name: o.figure_name ?? o.owner_username ?? (o.id != null ? `#${String(o.id).slice(0, 8)}` : ""),
      state: o.state,
      trigger: null,
      started: o.created_at,
      finished: o.finished_at,
      durationMs: durationMs(o.created_at, o.finished_at),
      changed: null,
      resultText:
        o.state === "failed"
          ? o.error_message || t("admin.tasks.result.failed_generic", { default: "Échec" })
          : o.state === "ready"
            ? t("admin.tasks.result.ocr_done", { default: "Texte extrait" })
            : t("admin.tasks.job_running"),
      raw: o,
    }));

    return [...jobs, ...scans, ...ocr];
  }, [jobsQ.data, scansQ.data, ocrQ.data, t]);

  // Dynamic type options = distinct job_name (+ scan / ocr), labelled.
  const typeOptions = useMemo(() => {
    const seen = new Map();
    for (const r of allRows) {
      if (!seen.has(r.type)) seen.set(r.type, r.typeLabel);
    }
    const opts = [...seen.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }));
    return [{ value: "all", label: t("admin.tasks.type.all", { default: "Tous les types" }) }, ...opts];
  }, [allRows, t]);

  // A coarse ticking clock (30 s) so the "Depuis" window slides over time
  // without reading Date.now() during render (which the React purity rule
  // forbids). The tick lands in a ref-backed value the memo can read.
  const now = useNowTick(30_000);

  // One pass over the merged rows applies every facet, derives the per-tab
  // counts (over the facet-filtered set MINUS the state tab, so each tab shows
  // how many it would reveal), then filters by the active state tab and sorts.
  const { rows, counts } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sinceBound = SINCE_MS[since];

    const facetMatch = (r) => {
      if (source !== "all" && r.source !== source) return false;
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (trigger !== "all" && r.trigger !== trigger) return false;
      if (hideNoop && r.source === "server" && r.state === "ready" && r.changed === 0) return false;
      if (sinceBound != null) {
        const ts = r.started ? new Date(r.started).getTime() : 0;
        if (now - ts > sinceBound) return false;
      }
      if (q) {
        const hay = `${r.typeLabel} ${r.name ?? ""} ${r.type} ${r.raw?.error_message ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    };
    const stateOf = (r) => {
      if (r.state === "failed") return "failed";
      if (r.state === "ready") return "ready";
      return "active"; // pending | processing | anything in-flight
    };

    const c = { all: 0, active: 0, failed: 0, ready: 0 };
    const filtered = [];
    for (const r of allRows) {
      if (!facetMatch(r)) continue;
      const tab = stateOf(r);
      c.all++;
      c[tab]++;
      if (stateTab === "all" || tab === stateTab) filtered.push(r);
    }

    const dir = sort.dir === "asc" ? 1 : -1;
    const byDuration = sort.key === "duration";
    filtered.sort((a, b) => {
      const av = byDuration ? (a.durationMs ?? -1) : new Date(a.started ?? 0).getTime();
      const bv = byDuration ? (b.durationMs ?? -1) : new Date(b.started ?? 0).getTime();
      return (av - bv) * dir;
    });

    return { rows: filtered, counts: c };
  }, [allRows, source, typeFilter, trigger, hideNoop, since, search, stateTab, sort, now]);

  // ─── Drawer ───
  const [openId, setOpenId] = useState(null);
  const openRow = rows.find((r) => r.id === openId) ?? allRows.find((r) => r.id === openId) ?? null;

  // ─── Table columns ───
  // Widths are tuned so the table FITS a ~820px admin column without a
  // horizontal scrollbar: État / Type / Déclencheur / Début / Durée are fixed
  // and narrow; Tâche + Résultat take the slack and truncate. `table-fixed`
  // (set on the DataTable) makes the browser honour these widths instead of
  // letting long content stretch a column.
  const columns = [
    {
      key: "name",
      header: t("admin.tasks.col.task", { default: "Tâche" }),
      // Flexible — no width; truncates within whatever space is left.
      render: (r) => (
        <span className="flex items-center gap-2 min-w-0">
          <span
            aria-hidden
            className="ja not-italic text-[13px] leading-none shrink-0"
            style={{ color: STATE_TONE[r.state] ?? OR }}
          >
            {STATE_KANJI[r.state] ?? "務"}
          </span>
          <span className="truncate text-[var(--on-surface)]" title={r.name ?? r.typeLabel}>
            {r.name ?? r.typeLabel}
          </span>
        </span>
      ),
    },
    {
      key: "type",
      header: t("admin.tasks.col.type", { default: "Type" }),
      width: "5.5rem",
      // Source label ("Serveur" / "Scan 3D" / "OCR"), distinct from "Tâche".
      render: (r) => (
        <span
          className="block truncate text-[12px] text-[var(--on-surface-muted)]"
          title={r.sourceLabel ?? r.typeLabel}
        >
          {r.sourceLabel ?? r.typeLabel}
        </span>
      ),
    },
    {
      key: "state",
      header: t("admin.tasks.col.state", { default: "État" }),
      width: "6.5rem",
      render: (r) => (
        <Badge tone={STATE_BADGE_TONE[r.state] ?? "neutral"}>
          <span aria-hidden className="ja not-italic text-[11px] leading-none">
            {STATE_KANJI[r.state] ?? "務"}
          </span>
          {t(`admin.tasks.status.${r.state}`)}
        </Badge>
      ),
    },
    {
      key: "trigger",
      header: t("admin.tasks.col.trigger", { default: "Déclencheur" }),
      width: "7rem",
      render: (r) =>
        r.trigger ? (
          <span
            className="block truncate text-[12px] text-[var(--on-surface-muted)]"
            title={
              r.trigger === "manual" && r.raw?.triggered_by_username
                ? `@${r.raw.triggered_by_username}`
                : undefined
            }
          >
            {t(`admin.tasks.trigger.${r.trigger}`, { default: r.trigger })}
            {r.trigger === "manual" && r.raw?.triggered_by_username ? (
              <span className="text-[var(--on-surface-subtle)]"> @{r.raw.triggered_by_username}</span>
            ) : null}
          </span>
        ) : (
          <span className="text-[12px] text-[var(--on-surface-subtle)]">—</span>
        ),
    },
    {
      key: "started",
      header: t("admin.tasks.col.started", { default: "Début" }),
      sortable: true,
      width: "6rem",
      render: (r) => (
        <span className="block truncate text-[12px] font-mono tabular-nums text-[var(--on-surface-muted)]">
          {rel(r.started, t)}
        </span>
      ),
    },
    {
      key: "duration",
      header: t("admin.tasks.col.duration", { default: "Durée" }),
      sortable: true,
      align: "right",
      width: "5.5rem",
      render: (r) => (
        <span className="block truncate text-[12px] font-mono tabular-nums text-[var(--on-surface-muted)]">
          {r.durationMs != null ? fmtDuration(r.durationMs) : "—"}
        </span>
      ),
    },
    {
      key: "result",
      header: t("admin.tasks.col.result", { default: "Résultat" }),
      // Flexible — shares the slack with "Tâche"; always truncates.
      render: (r) => (
        <span
          className="block truncate text-[12px]"
          style={{
            color:
              r.state === "failed"
                ? LAQUE
                : r.state === "ready"
                  ? "var(--color-jade)"
                  : "var(--on-surface-muted)",
          }}
          title={r.resultText}
        >
          {r.resultText}
        </span>
      ),
    },
  ];

  const services = servicesQ.data ?? [];

  return (
    <div className="relative">
      {/* ─── Editorial section header + console controls ─── */}
      <AdminSectionHeader
        kanji="務"
        kicker={t("admin.subtitle")}
        label={t("admin.tasks.kicker_label", { default: "FILE DE CALCUL" })}
        title={t("admin.tasks.title", { default: "Tâches" })}
        subtitle={t("admin.tasks.console_gloss", {
          default: "Tout le travail de fond du serveur, en un coup d'œil.",
        })}
        actions={
          <div className="flex items-center gap-3">
            <Switch
              checked={autoRefresh}
              onChange={setAutoRefresh}
              label={t("admin.tasks.auto_refresh", { default: "Rafraîchir auto" })}
            />
            <Tooltip label={t("admin.tasks.refresh", { default: "Rafraîchir maintenant" })}>
              <IconButton
                icon={RefreshCw}
                variant="outline"
                label={t("admin.tasks.refresh", { default: "Rafraîchir maintenant" })}
                loading={
                  scansQ.isFetching ||
                  jobsQ.isFetching ||
                  ocrQ.isFetching ||
                  servicesQ.isFetching
                }
                onClick={refetchAll}
              />
            </Tooltip>
          </div>
        }
      />

      {/* ─── Santé des services ─── */}
      {services.length > 0 ? (
        <section
          className="reveal mb-7"
          style={{ "--i": 0 }}
          aria-label={t("admin.tasks.services.title", { default: "Santé des services" })}
        >
          <p className="micro flex items-center gap-2 mb-2.5">
            <span aria-hidden className="ja not-italic text-[var(--color-or)]">健</span>
            {t("admin.tasks.services.title", { default: "Santé des services" })}
          </p>
          <div className="flex flex-wrap gap-2">
            {services.map((svc) => {
              const tone = serviceTone(svc.status);
              // last_error wins; else a readable flatten of the detail blob;
              // else the bare status label. (No raw JSON in the tooltip.)
              const detail =
                svc.last_error ||
                (svc.detail ? formatServiceDetail(svc.detail, t) : null) ||
                t(`admin.tasks.services.status.${svc.status}`, { default: svc.status });
              return (
                <Tooltip key={svc.service_name} label={detail}>
                  <span
                    tabIndex={0}
                    className="inline-flex items-center gap-2 px-2.5 py-1.5 border text-[11px] font-mono tracking-[0.04em] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    style={{
                      color: "var(--on-surface-muted)",
                      borderColor: `color-mix(in oklab, ${tone} 35%, transparent)`,
                      background: `color-mix(in oklab, ${tone} 7%, transparent)`,
                    }}
                  >
                    <span
                      aria-hidden
                      className="w-1.5 h-1.5 rotate-45 shrink-0"
                      style={{ background: tone }}
                    />
                    <span className="text-[var(--on-surface)]">
                      {t(`admin.tasks.job.${svc.service_name}`, { default: svc.service_name })}
                    </span>
                    {svc.last_beat_at ? (
                      <span className="text-[var(--on-surface-subtle)] tabular-nums">
                        {rel(svc.last_beat_at, t)}
                      </span>
                    ) : null}
                  </span>
                </Tooltip>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* ─── Filter bar (all persisted) ─── */}
      <section
        className="reveal mb-5 flex flex-col gap-3"
        style={{ "--i": 1 }}
        aria-label={t("admin.tasks.filter.region", { default: "Filtrer la file" })}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <SegmentedControl
            size="sm"
            aria-label={t("admin.tasks.filter.source", { default: "Source" })}
            value={source}
            onChange={setSource}
            options={[
              { value: "all", label: t("admin.tasks.source.all", { default: "Tout" }) },
              { value: "server", label: t("admin.tasks.source.server", { default: "Serveur" }) },
              { value: "scan", label: t("admin.tasks.source.scan", { default: "Scans 3D" }) },
              { value: "ocr", label: t("admin.tasks.source.ocr", { default: "OCR" }) },
            ]}
          />
          <SegmentedControl
            size="sm"
            aria-label={t("admin.tasks.meta.trigger", { default: "Déclencheur" })}
            value={trigger}
            onChange={setTrigger}
            options={[
              { value: "all", label: t("admin.tasks.trigger.all", { default: "Tous" }) },
              { value: "schedule", label: t("admin.tasks.trigger.schedule", { default: "planifié" }) },
              { value: "manual", label: t("admin.tasks.trigger.manual", { default: "manuel" }) },
            ]}
          />
          <Select
            className="min-w-[12rem]"
            value={typeFilter}
            onChange={setTypeFilter}
            options={typeOptions}
          />
          <Select
            className="min-w-[8rem]"
            value={since}
            onChange={setSince}
            options={[
              { value: "1h", label: t("admin.tasks.since.1h", { default: "1 h" }) },
              { value: "24h", label: t("admin.tasks.since.24h", { default: "24 h" }) },
              { value: "7d", label: t("admin.tasks.since.7d", { default: "7 j" }) },
              { value: "all", label: t("admin.tasks.since.all", { default: "Tout" }) },
            ]}
          />
          <div className="relative flex-1 min-w-[12rem]">
            <Search
              size={15}
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--on-surface-subtle)]"
            />
            <Input
              size="sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("admin.tasks.search.placeholder", { default: "Rechercher…" })}
              aria-label={t("admin.tasks.search.label", { default: "Rechercher une tâche" })}
              className="pl-9"
            />
          </div>
          <Switch
            checked={hideNoop}
            onChange={setHideNoop}
            label={t("admin.tasks.hide_noop", { default: "Masquer les runs sans effet" })}
          />
        </div>

        {/* State tabs with live counts */}
        <Tabs
          value={stateTab}
          onChange={setStateTab}
          tabs={[
            { value: "all", label: t("admin.tasks.filter.all", { default: "Toutes" }), count: counts.all },
            { value: "active", label: t("admin.tasks.filter.active", { default: "Actives" }), count: counts.active },
            { value: "ready", label: t("admin.tasks.filter.ready", { default: "Réussies" }), count: counts.ready },
            { value: "failed", label: t("admin.tasks.filter.failed", { default: "Échecs" }), count: counts.failed },
          ]}
        />
      </section>

      {/* ─── The console table ─── */}
      <section className="reveal" style={{ "--i": 2 }}>
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          sort={sort}
          onSort={setSort}
          stickyHeader
          tableClassName="table-fixed"
          loading={loading}
          onRowClick={(r) => setOpenId(r.id)}
          empty={
            <EmptyState
              compact
              kanji="務"
              eyebrow={t("admin.tasks.kicker_label", { default: "FILE DE CALCUL" })}
              title={t("admin.tasks.empty.title", { default: "Aucune tâche" })}
              body={t("admin.tasks.empty.body", {
                default: "Aucune tâche ne correspond aux filtres actuels.",
              })}
            />
          }
        />
      </section>

      {/* ─── Detail drawer ─── */}
      <TaskDrawer
        row={openRow}
        open={openId != null}
        onClose={() => setOpenId(null)}
        t={t}
        indexQueues={indexQueues}
      />

      {/* ─── Catalogue integrity (potential duplicates) — self-hides ─── */}
      <DuplicatesPanel t={t} />
    </div>
  );
}

// =============================================================================
// TaskDrawer — the row detail panel. State badge, type, trigger, timings,
// changed count, formatted result + collapsible raw JSON, an error well when
// failed, a progress bar for running scans/reindex, and the relevant actions
// (relaunch failed jobs; retry / fail / delete scans).
// =============================================================================

function TaskDrawer({ row, open, onClose, t, indexQueues }) {
  const retryScan = useRetryScan();
  const failScan = useFailScan();
  const delScan = useDeleteScan();
  const retryJob = useRetryJob();
  const delJob = useDeleteJob();
  const delOcr = useDeleteOcrJob();
  const [showRaw, setShowRaw] = useState(false);
  // Two independent inline confirms: the dedicated "Supprimer" (always shown)
  // and the "Annuler" of an in-flight row (which is itself a delete).
  const [confirmDel, setConfirmDel] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Reset the inline confirms whenever the drawer target changes.
  const rowKey = row?.id ?? null;
  const lastKey = useDrawerReset(rowKey, () => {
    setConfirmDel(false);
    setConfirmCancel(false);
    setShowRaw(false);
  });
  void lastKey;

  if (!row) {
    return <Drawer open={open} onClose={onClose} side="right" title={t("admin.tasks.title", { default: "Tâches" })} />;
  }

  const raw = row.raw;
  const tone = STATE_TONE[row.state] ?? OR;
  const isScan = row.source === "scan";
  const isJob = row.source === "server";
  // (ocr is the implicit third source — the delHook/retryHook fallbacks.)

  // ── One delete + one relaunch per source, so the matrix below stays flat ──
  // The row id the mutations want (scans/ocr expose the bare id on `raw`; jobs
  // too). The merged-row `row.id` is prefixed ("job-…") and is NOT the api id.
  const delHook = isScan ? delScan : isJob ? delJob : delOcr;
  const retryHook = isScan ? retryScan : isJob ? retryJob : null; // OCR: no relaunch
  const deleteRow = (after) => delHook.mutate(raw.id, { onSuccess: after });
  const relaunchRow = (after) => retryHook?.mutate(raw.id, { onSuccess: after });

  const closeAndReset = () => {
    setConfirmDel(false);
    setConfirmCancel(false);
    onClose();
  };

  // Lifecycle buckets driving the action matrix.
  const inFlight = row.state === "pending" || row.state === "processing";
  const relaunchable = (row.state === "ready" || row.state === "failed") && !!retryHook;

  // Disable the whole footer while ANY of this row's mutations are in flight.
  const busy =
    delHook.isPending ||
    retryScan.isPending ||
    retryJob.isPending ||
    failScan.isPending;

  // Live reindex drain progress (server jobs whose name maps to index kinds).
  const reindex = isJob && row.state === "processing"
    ? reindexProgress(raw.job_name, indexQueues)
    : null;

  const footer = (
    <div className="flex flex-wrap items-center gap-2">
      {/* In-flight → "Annuler" (a delete behind a confirm). */}
      {inFlight ? (
        confirmCancel ? (
          <span className="inline-flex items-center gap-2">
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              loading={delHook.isPending}
              onClick={() => deleteRow(closeAndReset)}
            >
              {t("admin.tasks.action.cancel.yes", { default: "Annuler la tâche" })}
            </Button>
            <Button variant="subtle" size="sm" disabled={busy} onClick={() => setConfirmCancel(false)}>
              {t("admin.tasks.cancel.no", { default: "Continuer" })}
            </Button>
          </span>
        ) : (
          <Button
            variant="danger"
            size="sm"
            disabled={busy}
            onClick={() => { setConfirmDel(false); setConfirmCancel(true); }}
          >
            {t("admin.tasks.action.cancel", { default: "Annuler" })}
          </Button>
        )
      ) : null}

      {/* Ready / failed → "Relancer" (jobs + scans; OCR has no endpoint). */}
      {relaunchable ? (
        <Button
          variant="primary"
          size="sm"
          disabled={busy}
          loading={retryHook?.isPending}
          onClick={() => relaunchRow(closeAndReset)}
        >
          {t("admin.tasks.action.retry", { default: "Relancer" })}
        </Button>
      ) : null}

      {/* Scan-only legacy affordance: mark an in-flight scan failed. */}
      {isScan && inFlight ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          loading={failScan.isPending}
          onClick={() => failScan.mutate(raw.id)}
        >
          {t("admin.tasks.action.fail", { default: "Marquer échouée" })}
        </Button>
      ) : null}

      {/* Terminal rows → "Supprimer" (behind a confirm). In-flight rows use
          "Annuler" above (same delete) — don't double up the control. */}
      {!inFlight ? (
        confirmDel ? (
        <span className="inline-flex items-center gap-2">
          <Button
            variant="danger"
            size="sm"
            disabled={busy}
            loading={delHook.isPending}
            onClick={() => deleteRow(closeAndReset)}
          >
            {t("admin.tasks.delete.yes", { default: "Supprimer" })}
          </Button>
          <Button variant="subtle" size="sm" disabled={busy} onClick={() => setConfirmDel(false)}>
            {t("admin.tasks.delete.no", { default: "Annuler" })}
          </Button>
        </span>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => { setConfirmCancel(false); setConfirmDel(true); }}
        >
          {t("admin.tasks.action.delete", { default: "Supprimer" })}
        </Button>
        )
      ) : null}
    </div>
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      side="right"
      title={row.name ?? row.typeLabel}
      footer={footer}
    >
      <div className="space-y-5">
        {/* State + type + trigger */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATE_BADGE_TONE[row.state] ?? "neutral"}>
            <span aria-hidden className="ja not-italic text-[11px] leading-none">
              {STATE_KANJI[row.state] ?? "務"}
            </span>
            {t(`admin.tasks.status.${row.state}`)}
          </Badge>
          <span className="text-[12px] text-[var(--on-surface-muted)]">{row.typeLabel}</span>
          {row.trigger ? (
            <span className="text-[11px] font-mono uppercase tracking-[0.12em] text-[var(--on-surface-subtle)]">
              {t(`admin.tasks.trigger.${row.trigger}`, { default: row.trigger })}
            </span>
          ) : null}
        </div>

        {/* Timings */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[12px]">
          <DrawerMeta
            label={t("admin.tasks.drawer.started", { default: "Début" })}
            value={fmtClock(row.started)}
            sub={rel(row.started, t)}
          />
          <DrawerMeta
            label={t("admin.tasks.drawer.finished", { default: "Fin" })}
            value={row.finished ? fmtClock(row.finished) : "—"}
            sub={row.finished ? rel(row.finished, t) : null}
          />
          <DrawerMeta
            label={t("admin.tasks.drawer.duration", { default: "Durée" })}
            value={row.durationMs != null ? fmtDuration(row.durationMs) : "—"}
          />
          {row.changed != null ? (
            <DrawerMeta
              label={t("admin.tasks.drawer.changed", { default: "Modifiés" })}
              value={String(row.changed)}
            />
          ) : null}
          {raw.triggered_by === "manual" && raw.triggered_by_username ? (
            <DrawerMeta
              label={t("admin.tasks.drawer.triggered_by", { default: "Déclenché par" })}
              value={`@${raw.triggered_by_username}`}
            />
          ) : null}
          {isScan && raw.owner_username ? (
            <DrawerMeta
              label={t("admin.tasks.meta.owner", { default: "Propriétaire" })}
              value={`@${raw.owner_username}`}
            />
          ) : null}
          {isScan && raw.worker_name ? (
            <DrawerMeta
              label={t("admin.tasks.meta.worker", { default: "Worker" })}
              value={raw.worker_name}
            />
          ) : null}
          {isScan && raw.attempts > 1 ? (
            <DrawerMeta
              label={t("admin.tasks.meta.attempts", { default: "Tentatives" })}
              value={String(raw.attempts)}
            />
          ) : null}
          {row.source === "ocr" && raw.worker_id ? (
            <DrawerMeta
              label={t("admin.tasks.meta.worker", { default: "Worker" })}
              value={String(raw.worker_id)}
            />
          ) : null}
        </dl>

        {/* Progress bar for running scans / reindex */}
        {isScan && row.state === "processing" ? (
          <ProgressBar pct={clampPct(raw.progress)} t={t} />
        ) : reindex ? (
          <ProgressBar pct={reindex.pct} done={reindex.done} total={reindex.total} t={t} />
        ) : null}

        {/* Result / error */}
        {row.state === "failed" ? (
          <div>
            <p className="micro mb-1.5 text-[var(--on-surface-muted)]">
              {t("admin.tasks.drawer.error", { default: "Erreur" })}
            </p>
            <p
              className="text-[12px] font-mono px-3 py-2"
              style={{
                color: LAQUE,
                background: "var(--color-noir-deep)",
                borderLeft: `2px solid color-mix(in oklab, ${LAQUE} 55%, transparent)`,
              }}
            >
              {raw.error_message || t("admin.tasks.result.failed_generic", { default: "Échec" })}
            </p>
          </div>
        ) : (
          <div>
            <p className="micro mb-1.5 text-[var(--on-surface-muted)]">
              {t("admin.tasks.drawer.result", { default: "Résultat" })}
            </p>
            <p
              className="text-[13px]"
              style={{ color: row.state === "ready" ? "var(--color-jade)" : "var(--on-surface)" }}
            >
              {row.resultText}
            </p>
          </div>
        )}

        {/* Collapsible raw JSON */}
        <div>
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            aria-expanded={showRaw}
            className="micro inline-flex items-center gap-1.5 text-[var(--on-surface-muted)] hover:text-[var(--on-surface)] transition-colors"
            style={{ color: tone }}
          >
            <span aria-hidden className="text-[10px]">{showRaw ? "▾" : "▸"}</span>
            {t("admin.tasks.drawer.raw", { default: "JSON brut" })}
          </button>
          {showRaw ? (
            <pre
              className="mt-2 text-[11px] font-mono leading-relaxed p-3 overflow-x-auto max-h-72 overflow-y-auto"
              style={{
                background: "var(--color-noir-deep)",
                border: "1px solid var(--border-subtle)",
                color: "var(--on-surface-muted)",
              }}
            >
              {JSON.stringify(raw, null, 2)}
            </pre>
          ) : null}
        </div>
      </div>
    </Drawer>
  );
}

// Reset hook: fires `reset` once whenever `key` changes. (Tiny local helper so
// the drawer clears its transient UI when the user clicks a different row.)
function useDrawerReset(key, reset) {
  const [last, setLast] = useState(key);
  if (key !== last) {
    setLast(key);
    reset();
  }
  return last;
}

function DrawerMeta({ label, value, sub }) {
  return (
    <div>
      <dt className="micro text-[var(--on-surface-subtle)]">{label}</dt>
      <dd className="mt-0.5 font-mono tabular-nums text-[var(--on-surface)]">{value}</dd>
      {sub ? <dd className="text-[11px] text-[var(--on-surface-subtle)] tabular-nums">{sub}</dd> : null}
    </div>
  );
}

function ProgressBar({ pct, done, total, t }) {
  return (
    <div>
      <div
        className="relative h-[6px] overflow-hidden"
        style={{ background: `color-mix(in oklab, ${OR} 14%, transparent)` }}
      >
        <i
          className="absolute inset-y-0 left-0 not-italic transition-[width] duration-500"
          style={{ width: `${pct}%`, background: OR }}
        />
      </div>
      <p className="mt-1.5 text-[11px] font-mono tabular-nums" style={{ color: OR }}>
        {done != null && total != null
          ? t("admin.tasks.indexing.progress", { done, total, pct, default: `${done} / ${total} · ${pct} %` })
          : t("admin.tasks.progress", { pct })}
      </p>
    </div>
  );
}

// Reindex job_name → index kind(s) it covers, so an in-flight reindex can show
// live drain progress from the embed-queue stats.
const REINDEX_KINDS = {
  reindex_image: ["image"],
  reindex_text: ["text"],
  reindex_look: ["look"],
  reindex_tags: ["tags"],
  reindex_owned_tags: ["owned-tags"],
  reindex_all: ["image", "text", "look", "tags"],
};

function reindexProgress(jobName, indexQueues) {
  const kinds = REINDEX_KINDS[jobName];
  if (!kinds) return null;
  const stats = kinds.map((k) => indexQueues.find((q) => q.index === k)).filter(Boolean);
  if (stats.length === 0) return null;
  const done = stats.reduce((a, s) => a + (s.done ?? 0), 0);
  const total = stats.reduce(
    (a, s) => a + (s.pending ?? 0) + (s.processing ?? 0) + (s.done ?? 0) + (s.failed ?? 0),
    0,
  );
  const pct = total > 0 ? clampPct((done / total) * 100) : 0;
  return { done, total, pct };
}

/** Absolute clock, locale-formatted, for the drawer timings. */
function fmtClock(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

// =============================================================================
// DuplicatesPanel — "Doublons potentiels": catalogue figures the DINOv2 index
// flags as visually near-identical. Read-only review aid; self-hides when
// nothing is flagged. NSFW shown un-blurred on purpose (admin needs to compare;
// the panel is require_admin-gated). Kept unchanged at the bottom of the page.
// =============================================================================

function DuplicatesPanel({ t }) {
  const dupes = useAdminVisualSearchDuplicates();
  const pairs = dupes.data ?? [];
  if (dupes.isPending || dupes.isError || pairs.length === 0) return null;

  return (
    <section
      className="reveal mt-10"
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

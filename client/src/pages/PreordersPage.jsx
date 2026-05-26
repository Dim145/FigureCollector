import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import {
  usePreorderHistory,
  usePreorders,
  useUpdatePreorder,
  useUpdatePreorderHistory,
} from "../hooks/useCollection.js";
import AppShell from "../components/AppShell.jsx";
import Button from "../components/Button.jsx";
import FormField from "../components/FormField.jsx";
import Select from "../components/Select.jsx";
import TrackingChip from "../components/TrackingChip.jsx";

/**
 * /preorders — the "Horarium", a hand-kept register of acquisitions to come.
 *
 * The page reads as a chronological ledger: entries grouped by release-date
 * month and threaded down a single gold spine. Each preorder is stamped
 * with a circular kanji seal indicating its lifecycle state (announced /
 * preordered / in production / shipped / received / cancelled). Imminent
 * releases (≤ 14 days out) get a pulsing gold glow.
 *
 * Designed to be readable at a glance ("what's next on the calendar?")
 * AND drill-downable ("what's the slip history on this one?"). The edit
 * form lives inline inside each entry so users never lose their place.
 */

/** Lifecycle states accepted by the server, in chronological order. */
const STATUS_OPTIONS = [
  "announced",
  "preorder_open",
  "preordered",
  "in_production",
  "released",
  "shipped",
  "received",
  "cancelled",
];

/** Kanji glyph for each lifecycle state — used in seals + filter chips. */
const STATUS_KANJI = {
  announced: "公",     // publish / make public
  preorder_open: "開", // open
  preordered: "約",    // contract / promise
  in_production: "製", // manufacture
  released: "発",      // depart / release
  shipped: "送",       // send
  received: "受",      // receive
  cancelled: "止",     // halt
};

const IMMINENT_DAYS = 14;

// =============================================================================
// Top-level page
// =============================================================================

export default function PreordersPage() {
  const t = useT();
  const me = useMe();
  const preorders = usePreorders();
  const [filter, setFilter] = useState("all");

  // ALL hooks must run on every render — keep them above any early return
  // so the hook ordering stays stable when auth state changes.
  const all = preorders.data ?? [];
  const sorted = useMemo(
    () =>
      [...all].sort((a, b) => {
        const ad =
          a.release_date_current ?? a.release_date_original ?? "9999-12-31";
        const bd =
          b.release_date_current ?? b.release_date_original ?? "9999-12-31";
        return ad.localeCompare(bd);
      }),
    [all],
  );
  const filtered = useMemo(
    () =>
      filter === "all"
        ? sorted
        : sorted.filter((p) => p.status === filter),
    [sorted, filter],
  );
  const countByStatus = useMemo(() => {
    const m = { all: all.length };
    for (const p of all) m[p.status] = (m[p.status] ?? 0) + 1;
    return m;
  }, [all]);
  const stats = useMemo(() => deriveStats(sorted, t), [sorted, t]);
  const months = useMemo(() => groupByMonth(filtered, t), [filtered, t]);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  return (
    <AppShell>
      <main className="horarium max-w-4xl mx-auto px-6 pt-12 pb-24">
        <Hero t={t} />
        {all.length > 0 ? (
          <>
            <StatRibbon stats={stats} t={t} />
            <FilterRail
              filter={filter}
              onChange={setFilter}
              counts={countByStatus}
              t={t}
            />
          </>
        ) : null}

        {all.length === 0 ? (
          <EmptyState t={t} />
        ) : filtered.length === 0 ? (
          <EmptyFilterState t={t} onClear={() => setFilter("all")} />
        ) : (
          <div className="horarium-timeline">
            {months.map((m) => (
              <MonthGroup key={m.key} month={m} t={t} />
            ))}
          </div>
        )}
      </main>
    </AppShell>
  );
}

// =============================================================================
// Hero
// =============================================================================

function Hero({ t }) {
  return (
    <header className="horarium-hero">
      <p className="horarium-hero-eyebrow">{t("preorders.subtitle")}</p>
      <h1 className="horarium-hero-title">{t("preorders.title")}</h1>
      <span className="horarium-hero-rule" aria-hidden />
    </header>
  );
}

// =============================================================================
// Stat ribbon — Total · Next · In transit
// =============================================================================

function StatRibbon({ stats, t }) {
  return (
    <section className="horarium-stats" aria-label={t("preorders.title")}>
      <div className="horarium-stat">
        <span className="horarium-stat-label">{t("preorders.stat.total")}</span>
        <span className="horarium-stat-value">{stats.total}</span>
      </div>

      <div className="horarium-stat">
        <span className="horarium-stat-label">{t("preorders.stat.next")}</span>
        {stats.next ? (
          <>
            <span className="horarium-stat-value">{stats.next.label}</span>
            <span className="horarium-stat-sub">{stats.next.title}</span>
          </>
        ) : (
          <span className="horarium-stat-value is-muted">
            {t("preorders.stat.next_none")}
          </span>
        )}
      </div>

      <div className="horarium-stat">
        <span className="horarium-stat-label">
          {t("preorders.stat.in_transit")}
        </span>
        {stats.inTransit > 0 ? (
          <span className="horarium-stat-value">{stats.inTransit}</span>
        ) : (
          <span className="horarium-stat-value is-muted">
            {t("preorders.stat.in_transit_none")}
          </span>
        )}
      </div>
    </section>
  );
}

// =============================================================================
// Filter rail — all + each lifecycle state
// =============================================================================

function FilterRail({ filter, onChange, counts, t }) {
  // Only show status chips that have at least one entry — keeps the rail
  // tight when most lifecycle states are empty.
  const visible = STATUS_OPTIONS.filter((s) => (counts[s] ?? 0) > 0);
  return (
    <nav className="horarium-filter" aria-label={t("preorders.field.status")}>
      <FilterChip
        active={filter === "all"}
        kanji="全"
        label={t("preorders.filter.all")}
        count={counts.all ?? 0}
        onClick={() => onChange("all")}
      />
      {visible.map((s) => (
        <FilterChip
          key={s}
          active={filter === s}
          kanji={STATUS_KANJI[s]}
          label={t(`status.${s}`)}
          count={counts[s]}
          onClick={() => onChange(s)}
        />
      ))}
    </nav>
  );
}

function FilterChip({ active, kanji, label, count, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`horarium-filter-chip ${active ? "is-active" : ""}`}
    >
      <span className="horarium-filter-chip-kanji" aria-hidden>
        {kanji}
      </span>
      <span>{label}</span>
      <span className="horarium-filter-chip-count" aria-hidden>
        {count}
      </span>
    </button>
  );
}

// =============================================================================
// Month group + entry
// =============================================================================

function MonthGroup({ month, t }) {
  return (
    <section>
      <header className="horarium-month">
        <span className="horarium-month-kanji" aria-hidden>月</span>
        <h2 className="horarium-month-label">{month.label}</h2>
        {month.year ? (
          <span className="horarium-month-year">{month.year}</span>
        ) : null}
      </header>
      {month.entries.map((p) => (
        <TimelineEntry key={p.id} preorder={p} t={t} />
      ))}
    </section>
  );
}

function TimelineEntry({ preorder: p, t }) {
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const countdown = countdownInfo(p.release_date_current, t);
  const slipCount = p.slip_count ?? 0;
  const status = p.status ?? "preordered";

  // Classes that drive the variant styling — cancelled, received, imminent
  const variantClasses = [
    status === "cancelled" ? "is-cancelled" : "",
    status === "received" ? "is-received" : "",
    countdown.imminent && status !== "cancelled" && status !== "received"
      ? "is-imminent"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const sealVariantClass = [
    status === "received" ? "is-received" : "",
    status === "shipped" ? "is-shipped" : "",
    status === "cancelled" ? "is-cancelled" : "",
    countdown.imminent && status !== "cancelled" && status !== "received"
      ? "is-imminent"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={`horarium-entry ${variantClasses}`}>
      <div className="horarium-entry-head">
        {/* The kanji seal + plain-text status label — the visual anchor of
         * the entry. The kanji alone wasn't legible without the filter
         * key alongside, so we stack a mono caps label under the circle
         * (carries the same variant class so it tones along with the seal). */}
        <div className="horarium-seal-stack">
          <div
            className={`horarium-seal ${sealVariantClass}`}
            aria-label={t(`status.${status}`)}
            title={t(`status.${status}`)}
          >
            {STATUS_KANJI[status] ?? "予"}
          </div>
          <span className={`horarium-status-label ${sealVariantClass}`}>
            {t(`status.${status}`)}
          </span>
        </div>

        {/* Body — title + maker */}
        <div className="horarium-entry-body">
          <span className="horarium-entry-kicker">
            {p.figure_type ? t(`type.${p.figure_type}`) : t(`status.${status}`)}
          </span>
          {p.figure_id ? (
            <Link to={`/figures/${p.figure_id}`} className="horarium-entry-title">
              {p.figure_name}
            </Link>
          ) : (
            <span className="horarium-entry-title">{p.figure_name}</span>
          )}
          {p.manufacturer_name ? (
            <span className="horarium-entry-maker">{p.manufacturer_name}</span>
          ) : null}
        </div>

        {/* Right aside — countdown + release date + slip indicator */}
        <div className="horarium-entry-aside">
          <span
            className={`horarium-countdown ${
              countdown.imminent && !countdown.past ? "is-imminent" : ""
            } ${countdown.past ? "is-past" : ""} ${
              countdown.unknown ? "is-tbc" : ""
            }`}
          >
            {countdown.label}
          </span>
          {p.release_date_current ? (
            <span className="horarium-entry-date">{p.release_date_current}</span>
          ) : null}
          {slipCount === 0 ? (
            <span className="horarium-entry-slip is-zero">
              {t("preorders.no_slip")}
            </span>
          ) : (
            <span className="horarium-entry-slip">
              {slipCount === 1
                ? t("preorders.slip_indicator_one")
                : t("preorders.slip_indicator_many", { n: slipCount })}
            </span>
          )}
        </div>
      </div>

      {/* Meta line — store + order ref + deposit (only when we have any) */}
      {(p.store || p.order_ref || p.deposit_amount) ? (
        <div className="horarium-entry-meta">
          {p.store ? (
            <span>
              <span className="horarium-entry-meta-key">
                {t("preorders.field.store")}
              </span>
              <span className="horarium-entry-meta-value">{p.store}</span>
            </span>
          ) : null}
          {p.order_ref ? (
            <span>
              <span className="horarium-entry-meta-key">
                {t("preorders.field.order_ref")}
              </span>
              <span className="horarium-entry-meta-value is-mono">
                {p.order_ref}
              </span>
            </span>
          ) : null}
          {p.deposit_amount ? (
            <span>
              <span className="horarium-entry-meta-key">
                {t("preorders.field.deposit")}
              </span>
              <span className="horarium-entry-meta-value is-mono">
                {Number(p.deposit_amount).toLocaleString(undefined, {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 2,
                })}{" "}
                {p.price_currency ?? ""}
              </span>
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Original date callout — only when a slip happened */}
      {p.release_date_original &&
      p.release_date_original !== p.release_date_current ? (
        <p className="mt-3 text-[10px] font-mono uppercase tracking-[0.22em] text-[var(--color-or-pale)]/70">
          {t("preorders.original_was", { date: p.release_date_original })}
        </p>
      ) : null}

      {/* Tracking chip */}
      {p.tracking_url ? (
        <div className="horarium-entry-tracking">
          <TrackingChip url={p.tracking_url} />
        </div>
      ) : null}

      {/* Actions or inline edit form */}
      {editing ? (
        <EditForm
          preorder={p}
          onClose={() => setEditing(false)}
          t={t}
        />
      ) : (
        <div className="horarium-entry-actions">
          {slipCount > 0 ? (
            <button
              type="button"
              onClick={() => setHistoryOpen((x) => !x)}
              className="horarium-entry-action"
            >
              {historyOpen ? "−" : "+"} {t("preorders.history_title")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="horarium-entry-action"
          >
            ✎ {t("preorders.edit")}
          </button>
        </div>
      )}

      {historyOpen ? <PreorderHistory id={p.id} t={t} /> : null}
    </article>
  );
}

// =============================================================================
// Edit form (inline)
// =============================================================================

function EditForm({ preorder: p, onClose, t }) {
  const [form, setForm] = useState(() => ({
    status: p.status ?? "preordered",
    store: p.store ?? "",
    order_ref: p.order_ref ?? "",
    tracking_url: p.tracking_url ?? "",
    release_date: p.release_date_current ?? "",
    deposit_amount:
      p.deposit_amount != null ? String(p.deposit_amount) : "",
    note: "",
  }));
  const update = useUpdatePreorder();
  const set = (k) => (v) => setForm((s) => ({ ...s, [k]: v }));

  // Quick-status chips — jump to "shipped" / "received" / "cancelled"
  // without filling the whole form.
  const quickStatus = (next) =>
    update.mutate({ id: p.id, patch: { status: next } });

  const onSubmit = async (e) => {
    e.preventDefault();
    const nz = (s) =>
      typeof s === "string" && s.trim() !== "" ? s.trim() : null;
    const num = (s) => {
      if (!s || s === "") return null;
      const n = Number.parseFloat(s);
      return Number.isFinite(n) ? n : null;
    };
    const payload = {
      status: form.status,
      store: nz(form.store),
      order_ref: nz(form.order_ref),
      tracking_url: nz(form.tracking_url),
      release_date: form.release_date || null,
      release_date_note: nz(form.note),
      deposit_amount: num(form.deposit_amount),
    };
    await update.mutateAsync({ id: p.id, patch: payload });
    onClose();
  };

  return (
    <form onSubmit={onSubmit} className="horarium-entry-form space-y-5">
      {/* Quick status transitions */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="micro-tight mr-2">{t("preorders.quick.title")}</span>
        <QuickStatusBtn
          label={t("status.shipped")}
          active={form.status === "shipped"}
          onClick={() => {
            set("status")("shipped");
            quickStatus("shipped");
          }}
        />
        <QuickStatusBtn
          label={t("status.received")}
          active={form.status === "received"}
          tone="gold"
          onClick={() => {
            set("status")("received");
            quickStatus("received");
          }}
        />
        <QuickStatusBtn
          label={t("status.cancelled")}
          active={form.status === "cancelled"}
          tone="laque"
          onClick={() => {
            set("status")("cancelled");
            quickStatus("cancelled");
          }}
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Select
          label={t("preorders.field.status")}
          value={form.status}
          onChange={set("status")}
          options={STATUS_OPTIONS.map((s) => ({
            value: s,
            label: t(`status.${s}`),
          }))}
        />
        <FormField
          label={t("preorders.field.release_date")}
          type="date"
          value={form.release_date}
          onChange={set("release_date")}
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <FormField
          label={t("preorders.field.store")}
          value={form.store}
          onChange={set("store")}
          placeholder={t("preorders.field.store_ph")}
        />
        <FormField
          label={t("preorders.field.order_ref")}
          value={form.order_ref}
          onChange={set("order_ref")}
          placeholder={t("preorders.field.order_ref_ph")}
        />
      </div>

      <div>
        <FormField
          label={t("preorders.field.tracking_url")}
          type="url"
          value={form.tracking_url}
          onChange={set("tracking_url")}
          placeholder={t("preorders.field.tracking_url_ph")}
          hint={t("preorders.field.tracking_url_hint")}
        />
        {form.tracking_url ? (
          <div className="mt-3">
            <TrackingChip url={form.tracking_url} size="compact" />
          </div>
        ) : null}
      </div>

      <FormField
        label={t("preorders.field.deposit")}
        type="number"
        value={form.deposit_amount}
        onChange={set("deposit_amount")}
        placeholder={t("preorders.field.deposit_ph")}
        hint={t("preorders.field.deposit_hint")}
      />

      <FormField
        label={t("preorders.bump_note")}
        value={form.note}
        onChange={set("note")}
        placeholder={t("preorders.bump_note_ph")}
        hint={t("preorders.bump_note_hint")}
      />

      {update.isError ? (
        <p
          role="alert"
          className="text-sm text-[var(--color-laque-bright)] border-l-2 border-[var(--color-laque-bright)] pl-3 py-1"
        >
          {update.error?.message}
        </p>
      ) : null}

      <div className="flex justify-end gap-3 pt-2">
        <Button
          variant="ghost"
          type="button"
          onClick={onClose}
          disabled={update.isPending}
        >
          {t("editor.cancel")}
        </Button>
        <Button type="submit" variant="primary" loading={update.isPending}>
          {t("preorders.save")}
        </Button>
      </div>
    </form>
  );
}

function QuickStatusBtn({ label, active, onClick, tone = "default" }) {
  const toneClass =
    tone === "gold"
      ? active
        ? "bg-[var(--color-or)] text-[var(--color-noir)] border-[var(--color-or)]"
        : "border-[var(--color-or)]/40 text-[var(--color-or)] hover:border-[var(--color-or)] hover:bg-[var(--color-or)]/10"
      : tone === "laque"
        ? active
          ? "bg-[var(--color-laque)] text-[var(--color-ivoire)] border-[var(--color-laque)]"
          : "border-[var(--color-laque-bright)]/40 text-[var(--color-laque-bright)] hover:border-[var(--color-laque-bright)] hover:bg-[var(--color-laque)]/10"
        : active
          ? "bg-[var(--color-or)]/15 text-[var(--color-or)] border-[var(--color-or)]"
          : "border-[var(--color-or)]/30 text-[var(--color-ivoire-soft)] hover:border-[var(--color-or)]/70 hover:text-[var(--color-or-pale)]";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] border transition-colors ${toneClass}`}
    >
      {label}
    </button>
  );
}

// =============================================================================
// Slip-history accordion
// =============================================================================

function PreorderHistory({ id, t }) {
  const history = usePreorderHistory(id);
  if (history.isLoading) return null;
  if (!history.data?.length) return null;

  return (
    <section className="horarium-history">
      <header className="horarium-history-heading">
        <span className="horarium-history-heading-kanji" aria-hidden>記</span>
        <h3 className="horarium-history-heading-label">
          {t("preorders.history_title")}
        </h3>
      </header>
      <ol className="horarium-history-list">
        {history.data.map((entry) => (
          <HistoryEntry key={entry.id} preorderId={id} entry={entry} t={t} />
        ))}
      </ol>
    </section>
  );
}

/** Single slip-history line. The reason is the focal point — date transition
 *  appears as a quiet mono badge, the note text takes display-serif italic.
 *  When absent, an italic placeholder invites the user to fill it in. The
 *  inline edit form lets the user revise an old reason after the fact.
 *  Local `note` state only exists while the edit form is open; opening the
 *  form seeds it from the server value, so a successful save (which
 *  refetches the parent query) just makes the new value the source of
 *  truth without any sync gymnastics. */
function HistoryEntry({ preorderId, entry, t }) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const update = useUpdatePreorderHistory();

  const openEditor = () => {
    setNote(entry.note ?? "");
    setEditing(true);
  };

  const onSave = (e) => {
    e.preventDefault();
    update.mutate(
      { preorderId, entryId: entry.id, note: note.trim() || null },
      {
        onSuccess: () => setEditing(false),
      },
    );
  };

  const hasNote = !!entry.note?.trim();

  return (
    <li className="horarium-history-item">
      <span className="horarium-history-dates">
        <span>{entry.previous_date ?? "?"}</span>
        <span className="horarium-history-arrow" aria-hidden>→</span>
        <span>{entry.new_date ?? "?"}</span>
      </span>

      {editing ? (
        <form className="horarium-history-form" onSubmit={onSave}>
          <input
            type="text"
            className="horarium-history-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("preorders.history.note_ph")}
            autoFocus
            disabled={update.isPending}
          />
          <div className="horarium-history-form-actions">
            <button
              type="button"
              className="horarium-history-form-btn is-cancel"
              onClick={() => {
                setNote(entry.note ?? "");
                setEditing(false);
              }}
              disabled={update.isPending}
            >
              {t("preorders.history.cancel")}
            </button>
            <button
              type="submit"
              className="horarium-history-form-btn is-save"
              disabled={update.isPending}
            >
              {t("preorders.history.save_note")}
            </button>
          </div>
        </form>
      ) : (
        <>
          <span
            className={`horarium-history-note ${hasNote ? "" : "is-empty"}`}
          >
            {hasNote ? entry.note : t("preorders.history.no_note")}
          </span>
          <div className="horarium-history-note-actions">
            <button
              type="button"
              className="horarium-history-edit-btn"
              onClick={openEditor}
            >
              ✎{" "}
              {hasNote
                ? t("preorders.history.edit_existing")
                : t("preorders.history.edit_note")}
            </button>
          </div>
        </>
      )}
    </li>
  );
}

// =============================================================================
// Empty states
// =============================================================================

function EmptyState({ t }) {
  return (
    <div className="horarium-empty">
      <h2 className="horarium-empty-title">{t("preorders.empty")}</h2>
      <p className="horarium-empty-hint">{t("preorders.empty.hint")}</p>
    </div>
  );
}

function EmptyFilterState({ t, onClear }) {
  return (
    <div className="horarium-empty">
      <h2 className="horarium-empty-title">{t("preorders.empty")}</h2>
      <button
        type="button"
        onClick={onClear}
        className="mt-4 text-[10px] uppercase tracking-[0.22em] text-[var(--color-or-pale)] hover:text-[var(--color-or)] transition-colors border border-[var(--color-or)]/40 hover:border-[var(--color-or)] px-4 py-2"
      >
        ↶ {t("preorders.filter.all")}
      </button>
    </div>
  );
}

// =============================================================================
// Date utilities
// =============================================================================

/** Compute summary stats for the stat ribbon. */
function deriveStats(sorted, t) {
  const total = sorted.length;
  const inTransit = sorted.filter((p) => p.status === "shipped").length;
  // The "next release" is the soonest non-received, non-cancelled item with
  // a future or today release date. Falls back to nearest past-due if none
  // are upcoming.
  const upcoming = sorted.find((p) => {
    if (p.status === "received" || p.status === "cancelled") return false;
    const d = p.release_date_current;
    if (!d) return false;
    return d >= todayISO();
  });
  const fallback =
    !upcoming
      ? sorted.find(
          (p) => p.status !== "received" && p.status !== "cancelled",
        )
      : null;
  const candidate = upcoming ?? fallback;
  const next = candidate
    ? {
        title: candidate.figure_name,
        label: countdownInfo(candidate.release_date_current, t).label,
      }
    : null;
  return { total, next, inTransit };
}

/** YYYY-MM-DD for today in the local timezone. */
function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Group entries by YYYY-MM. Returns [{ key, label, year, entries: [] }]. */
function groupByMonth(entries, t) {
  const map = new Map();
  for (const p of entries) {
    const date = p.release_date_current ?? p.release_date_original ?? null;
    const key = date ? date.slice(0, 7) : "unknown";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  }
  return [...map.entries()].map(([key, list]) => {
    if (key === "unknown") {
      return { key, label: t("preorders.month.unknown"), year: null, entries: list };
    }
    const [y, m] = key.split("-");
    const d = new Date(Number(y), Number(m) - 1, 1);
    // Localised month name (default to FR via toLocaleDateString — the app
    // is FR-first but this also works for EN since the user's locale
    // applies).
    const label = d.toLocaleDateString(undefined, { month: "long" });
    return {
      key,
      label: label.charAt(0).toUpperCase() + label.slice(1),
      year: y,
      entries: list,
    };
  });
}

/** Compute a human-readable countdown label given a YYYY-MM-DD release
 *  date and the translator. Returns:
 *    { label, imminent, past, unknown }
 */
function countdownInfo(dateStr, t) {
  if (!dateStr) {
    return {
      label: t("preorders.countdown.unknown"),
      imminent: false,
      past: false,
      unknown: true,
    };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  const msPerDay = 86400000;
  const diffDays = Math.round((target - today) / msPerDay);

  if (diffDays === 0) {
    return {
      label: t("preorders.countdown.today"),
      imminent: true,
      past: false,
      unknown: false,
    };
  }
  if (diffDays === 1) {
    return {
      label: t("preorders.countdown.tomorrow"),
      imminent: true,
      past: false,
      unknown: false,
    };
  }
  if (diffDays > 0) {
    // Future
    if (diffDays <= 14) {
      return {
        label: t("preorders.countdown.days", { n: diffDays }),
        imminent: true,
        past: false,
        unknown: false,
      };
    }
    if (diffDays <= 60) {
      const weeks = Math.round(diffDays / 7);
      return {
        label: t("preorders.countdown.weeks", { n: weeks }),
        imminent: false,
        past: false,
        unknown: false,
      };
    }
    const months = Math.round(diffDays / 30);
    return {
      label: t("preorders.countdown.months", { n: months }),
      imminent: false,
      past: false,
      unknown: false,
    };
  }
  // Past
  const absDays = -diffDays;
  if (absDays < 60) {
    return {
      label: t("preorders.countdown.past_days", { n: absDays }),
      imminent: false,
      past: true,
      unknown: false,
    };
  }
  const months = Math.round(absDays / 30);
  return {
    label: t("preorders.countdown.past_months", { n: months }),
    imminent: false,
    past: true,
    unknown: false,
  };
}

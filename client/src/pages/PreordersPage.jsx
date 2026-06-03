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
import CancellationDialog from "../components/CancellationDialog.jsx";
import FormField from "../components/FormField.jsx";
import Select from "../components/Select.jsx";
import StoreAutocomplete from "../components/StoreAutocomplete.jsx";
import TrackingChip from "../components/TrackingChip.jsx";
import Reveal from "../components/motion/Reveal.jsx";
import {
  countdownTone,
  deliveryCountdown,
  deliveryDateLabel,
  formatCountdown,
} from "../lib/deliveryCountdown.js";

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

/**
 * Lifecycle → accent colour (STYLING ONLY). Every value is a theme CSS var,
 * so the whole palette flips with the light/dark theme. Early states glow
 * indigo (the "nuit" of anticipation), the open/announce window leans gold,
 * production warms to amber, shipping turns cyan (in motion), receipt settles
 * to jade (in hand), and cancellation falls to laque red. The page exposes
 * each entry's colour as a single `--accent` custom property (see
 * `accentVars`) so borders, seals, chips and washes all tone together off
 * one variable.
 */
const STATUS_ACCENT = {
  announced: "var(--color-indigo)",
  preorder_open: "var(--color-or)",
  preordered: "var(--color-or-pale)",
  in_production: "var(--color-neon-amber)",
  released: "var(--color-neon-amber)",
  shipped: "var(--color-neon-cyan)",
  received: "var(--color-jade)",
  cancelled: "var(--color-laque-bright)",
};

/** The accent for a given lifecycle status (falls back to gold). */
function statusAccent(status) {
  return STATUS_ACCENT[status] ?? "var(--color-or)";
}

/** Inline-style object exposing a status' accent as `--accent` so an
 *  element's children/pseudo styling can reference one variable. Imminent
 *  upcoming releases are nudged to neon-amber regardless of status, since
 *  "it's almost here" is the more urgent signal than the lifecycle slot. */
function accentVars(status, imminent) {
  const accent =
    imminent && status !== "cancelled" && status !== "received"
      ? "var(--color-neon-amber)"
      : statusAccent(status);
  return { "--accent": accent };
}

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

function Hero({ t }) {
  return (
    <header className="horarium-hero">
      {/* Localised colour-wash — two soft accent blooms behind the title.
       *  Absolutely positioned + pointer-events-none so it never intercepts
       *  clicks, low-alpha theme vars so it flips with the theme and stays
       *  tasteful over the global aurora. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-8 -bottom-4 z-0"
        style={{
          background:
            "radial-gradient(60% 70% at 30% 35%, color-mix(in oklab, var(--color-indigo) 22%, transparent), transparent 70%), radial-gradient(55% 65% at 72% 60%, color-mix(in oklab, var(--color-neon-amber) 16%, transparent), transparent 72%)",
          maskImage:
            "radial-gradient(80% 90% at 50% 45%, black, transparent 100%)",
        }}
      />
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
  // A hairline accent sits along the top edge of each lozenge — gold for the
  // ledger total, amber for the next-up countdown (urgency), cyan for parcels
  // in motion. All theme vars, so they flip with the theme.
  const edge = (accent) => ({
    boxShadow: `inset 0 2px 0 -1px color-mix(in oklab, ${accent} 55%, transparent)`,
  });
  return (
    <Reveal as="section" y={16} className="horarium-stats" aria-label={t("preorders.title")}>
      <div className="horarium-stat" style={edge("var(--color-or)")}>
        <span className="horarium-stat-label">{t("preorders.stat.total")}</span>
        <span
          className="horarium-stat-value"
          style={{ color: "var(--color-or)" }}
        >
          {stats.total}
        </span>
      </div>

      <div className="horarium-stat" style={edge("var(--color-neon-amber)")}>
        <span className="horarium-stat-label">{t("preorders.stat.next")}</span>
        {stats.next ? (
          <>
            <span
              className="horarium-stat-value"
              style={{ color: "var(--color-neon-amber)" }}
            >
              {stats.next.label}
            </span>
            <span className="horarium-stat-sub">{stats.next.title}</span>
          </>
        ) : (
          <span className="horarium-stat-value is-muted">
            {t("preorders.stat.next_none")}
          </span>
        )}
      </div>

      <div className="horarium-stat" style={edge("var(--color-neon-cyan)")}>
        <span className="horarium-stat-label">
          {t("preorders.stat.in_transit")}
        </span>
        {stats.inTransit > 0 ? (
          <span
            className="horarium-stat-value"
            style={{ color: "var(--color-neon-cyan)" }}
          >
            {stats.inTransit}
          </span>
        ) : (
          <span className="horarium-stat-value is-muted">
            {t("preorders.stat.in_transit_none")}
          </span>
        )}
      </div>
    </Reveal>
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
        accent="var(--color-or)"
        label={t("preorders.filter.all")}
        count={counts.all ?? 0}
        onClick={() => onChange("all")}
      />
      {visible.map((s) => (
        <FilterChip
          key={s}
          active={filter === s}
          kanji={STATUS_KANJI[s]}
          accent={statusAccent(s)}
          label={t(`status.${s}`)}
          count={counts[s]}
          onClick={() => onChange(s)}
        />
      ))}
    </nav>
  );
}

function FilterChip({ active, kanji, accent, label, count, onClick }) {
  // The chip's kanji carries the lifecycle accent, turning the filter rail
  // into a living colour-key. When active, the whole chip picks up a soft
  // accent ring + wash on top of the existing .is-active gold styling.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`horarium-filter-chip ${active ? "is-active" : ""}`}
      style={
        active
          ? {
              borderColor: `color-mix(in oklab, ${accent} 70%, transparent)`,
              boxShadow: `0 0 0 1px color-mix(in oklab, ${accent} 30%, transparent), 0 6px 18px -12px color-mix(in oklab, ${accent} 60%, transparent)`,
            }
          : undefined
      }
    >
      <span
        className="horarium-filter-chip-kanji"
        aria-hidden
        style={{ color: accent, opacity: active ? 1 : 0.75 }}
      >
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
      <Reveal as="header" y={14} amount={0.6} className="horarium-month">
        <span
          className="horarium-month-kanji"
          aria-hidden
          style={{
            color: "var(--color-indigo)",
            borderColor:
              "color-mix(in oklab, var(--color-indigo) 55%, transparent)",
            boxShadow:
              "0 0 18px -6px color-mix(in oklab, var(--color-indigo) 70%, transparent)",
          }}
        >
          月
        </span>
        <h2 className="horarium-month-label">{month.label}</h2>
        {month.year ? (
          <span className="horarium-month-year">{month.year}</span>
        ) : null}
        {/* A short accent rule trailing off the month label — adds horizon
         *  and motion to an otherwise flat divider. Theme-var gradient. */}
        <span
          aria-hidden
          className="pointer-events-none hidden sm:block h-px flex-1 self-center"
          style={{
            background:
              "linear-gradient(90deg, color-mix(in oklab, var(--color-indigo) 40%, transparent), transparent)",
          }}
        />
      </Reveal>
      {month.entries.map((p, i) => (
        <TimelineEntry key={p.id} preorder={p} index={i} t={t} />
      ))}
    </section>
  );
}

function TimelineEntry({ preorder: p, index = 0, t }) {
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const countdown = countdownInfo(p.release_date_current, t);
  const slipCount = p.slip_count ?? 0;
  const status = p.status ?? "preordered";
  const imminent =
    countdown.imminent && status !== "cancelled" && status !== "received";

  // The accent for this lifecycle state, exposed as a single `--accent`
  // custom property the decorative elements below reference. Pure styling.
  const accent = accentVars(status, imminent)["--accent"];
  // Stagger the scroll reveal within a month, but cap it so a long month
  // never leaves the last rows waiting too long.
  const revealDelay = Math.min(index * 0.06, 0.3);

  // Classes that drive the variant styling — cancelled, received, imminent
  const variantClasses = [
    status === "cancelled" ? "is-cancelled" : "",
    status === "received" ? "is-received" : "",
    imminent ? "is-imminent" : "",
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
    <Reveal
      as="article"
      delay={revealDelay}
      y={20}
      className={`horarium-entry group ${variantClasses}`}
      style={{
        "--accent": accent,
        // Lift the entry's border toward its lifecycle accent without
        // overriding the variant-specific CSS that follows. (The :hover
        // border shift defined in index.css still applies on top.)
        borderColor: `color-mix(in oklab, ${accent} 22%, transparent)`,
      }}
    >
      {/* Accent spine — a thin colour-coded bar fused to the entry's left
       *  edge, echoing the gold thread but in the entry's own lifecycle hue.
       *  Widens + brightens on hover (transform/opacity only). Decorative,
       *  pointer-events-none, theme-var driven. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 bottom-0 w-[2px] origin-left scale-x-50 opacity-70 transition-[transform,opacity] duration-300 ease-out group-hover:scale-x-100 group-hover:opacity-100 motion-reduce:transition-none"
        style={{
          background: `linear-gradient(180deg, transparent, color-mix(in oklab, ${accent} 60%, transparent) 18%, color-mix(in oklab, ${accent} 38%, transparent) 82%, transparent)`,
        }}
      />
      {/* Hover colour-wash — a faint accent bloom from the seal corner that
       *  fades in on hover, giving each entry a moment of its own colour
       *  without disturbing the resting layout. Opacity-only transition. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 ease-out group-hover:opacity-100 motion-reduce:transition-none motion-reduce:group-hover:opacity-0"
        style={{
          background: `radial-gradient(70% 80% at 0% 0%, color-mix(in oklab, ${accent} 12%, transparent), transparent 60%)`,
        }}
      />
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
            style={
              // Received/cancelled keep their bespoke CSS treatment; every
              // other state borrows its lifecycle accent for ring + glyph.
              status === "received" || status === "cancelled"
                ? undefined
                : {
                    color: accent,
                    borderColor: `color-mix(in oklab, ${accent} 60%, transparent)`,
                    boxShadow: `0 0 16px -6px color-mix(in oklab, ${accent} 75%, transparent)`,
                  }
            }
          >
            {STATUS_KANJI[status] ?? "予"}
          </div>
          <span
            className={`horarium-status-label ${sealVariantClass}`}
            style={
              status === "received" || status === "cancelled"
                ? undefined
                : { color: `color-mix(in oklab, ${accent} 85%, var(--color-ivoire-soft))` }
            }
          >
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
            style={
              // Colour-code a live (future, non-TBC) countdown with the
              // entry's accent so "imminent" reads as warm amber, "in
              // transit" as cyan, etc. Past / TBC keep the muted CSS look.
              !countdown.past && !countdown.unknown
                ? {
                    color: accent,
                    borderColor: `color-mix(in oklab, ${accent} ${imminent ? 70 : 40}%, transparent)`,
                    background: `color-mix(in oklab, ${accent} ${imminent ? 16 : 8}%, transparent)`,
                  }
                : undefined
            }
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
      {(p.store_name || p.order_ref || p.deposit_amount) ? (
        <div className="horarium-entry-meta">
          {p.store_name ? (
            <span>
              <span className="horarium-entry-meta-key">
                {t("preorders.field.store")}
              </span>
              <span className="horarium-entry-meta-value">
                {p.store_slug ? (
                  <Link
                    to={`/stores/${p.store_slug}`}
                    className="underline decoration-[var(--color-or)]/30 hover:decoration-[var(--color-or)] underline-offset-4"
                  >
                    {p.store_name}
                  </Link>
                ) : (
                  p.store_name
                )}
              </span>
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
          {/* Delivery countdown — surfaces here too so the user can spot
           *  an overdue parcel without expanding the entry. Native `title`
           *  reveals the exact projected delivery date. */}
          {(() => {
            const days = deliveryCountdown(p);
            if (days == null) return null;
            const date = deliveryDateLabel(p);
            const tip = date ? t("preorder.delivery.tooltip", { date }) : undefined;
            return (
              <span title={tip} className="cursor-help">
                <span className="horarium-entry-meta-key">
                  {t("preorders.field.delivery_chip_label")}
                </span>
                <span
                  className={`horarium-entry-meta-value is-mono ${countdownTone(days)}`}
                >
                  {formatCountdown(days, t)}
                </span>
              </span>
            );
          })()}
        </div>
      ) : null}

      {/* Original date callout — only when a slip happened */}
      {p.release_date_original &&
      p.release_date_original !== p.release_date_current ? (
        <p className="mt-3 text-[10px] font-mono uppercase tracking-[0.22em] text-[var(--color-or-pale)]/70">
          {t("preorders.original_was", { date: p.release_date_original })}
        </p>
      ) : null}

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
    </Reveal>
  );
}

// =============================================================================
// Edit form (inline)
// =============================================================================

function EditForm({ preorder: p, onClose, t }) {
  const [form, setForm] = useState(() => ({
    status: p.status ?? "preordered",
    // Seed the autocomplete from the joined store_name. The save flow still
    // sends a free-text `store` string, which the server resolves via
    // upsert_store() — so swapping name on save still works.
    store: p.store_name ?? "",
    order_ref: p.order_ref ?? "",
    tracking_url: p.tracking_url ?? "",
    release_date: p.release_date_current ?? "",
    deposit_amount:
      p.deposit_amount != null ? String(p.deposit_amount) : "",
    estimated_delivery_days:
      p.estimated_delivery_days != null ? String(p.estimated_delivery_days) : "",
    note: "",
  }));
  const [cancelOpen, setCancelOpen] = useState(false);
  const update = useUpdatePreorder();
  const set = (k) => (v) => setForm((s) => ({ ...s, [k]: v }));

  // Quick-status chips — jump to "shipped" / "received" without filling
  // the whole form. Cancellation goes through CancellationDialog so the
  // user is prompted for the refund amount + the owned_item fate; we
  // never silently flip a preorder to `cancelled`.
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
      estimated_delivery_days: form.estimated_delivery_days
        ? Number.parseInt(form.estimated_delivery_days, 10) || null
        : null,
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
          onClick={() => setCancelOpen(true)}
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
        <StoreAutocomplete
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

      {/* Delivery ETA — only meaningful from `shipped` onward. We keep it
       *  editable in all states so the user can pre-fill it (some carriers
       *  give an ETA the moment the parcel is dropped off, before our
       *  status flip catches up). */}
      <FormField
        label={t("preorders.field.delivery_days")}
        type="number"
        value={form.estimated_delivery_days}
        onChange={set("estimated_delivery_days")}
        placeholder={t("preorders.field.delivery_days_ph")}
        hint={t("preorders.field.delivery_days_hint")}
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

      {cancelOpen ? (
        <CancellationDialog
          preorder={p}
          ownedId={p.owned_item_id ?? null}
          onClose={() => {
            setCancelOpen(false);
            // The mutation already invalidates ["preorders"] and ["owned"]
            // so the parent re-renders with the cancelled row out of
            // sight (or with archived chip) — just dismiss our local UI.
            onClose();
          }}
        />
      ) : null}
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
    <Reveal className="horarium-empty" y={16}>
      <h2 className="horarium-empty-title">{t("preorders.empty")}</h2>
      <p className="horarium-empty-hint">{t("preorders.empty.hint")}</p>
    </Reveal>
  );
}

function EmptyFilterState({ t, onClear }) {
  return (
    <Reveal className="horarium-empty" y={16}>
      <h2 className="horarium-empty-title">{t("preorders.empty")}</h2>
      <button
        type="button"
        onClick={onClear}
        className="mt-4 text-[10px] uppercase tracking-[0.22em] text-[var(--color-or-pale)] hover:text-[var(--color-or)] transition-colors border border-[var(--color-or)]/40 hover:border-[var(--color-or)] px-4 py-2"
      >
        ↶ {t("preorders.filter.all")}
      </button>
    </Reveal>
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

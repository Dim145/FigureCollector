import { useMemo } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  Cell as RechartsCell,
  Pie as RechartsPie,
  PieChart as RechartsPieChart,
  Tooltip as RechartsTooltip,
} from "recharts";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useMyStats } from "../hooks/useStats.js";
import AppShell from "../components/AppShell.jsx";
import Card from "../components/Card.jsx";
import CountUp from "../components/CountUp.jsx";

/**
 * Le Grand Livre — the user's annual inventory ledger.
 *
 * Aesthetic moves:
 *   - Hero ledger spread (vertical tag + huge embossed figural)
 *   - Roman-numeral chapter dividers with kanji subtitle
 *   - Brass-tabbed ledger rows for spend per currency (+ sparkline)
 *   - Donut breakdowns (Recharts) for type + condition
 *   - Podium for top-3 manufacturers/series/sculptors (lists below)
 *   - Press-strip year timeline with letterpress numbers above each bar
 *   - "Pièce de la couronne" feature card for the most expensive piece
 *   - Thermometer rule for the price distribution
 *
 * Only the donut breakdowns use a charting library (Recharts) — the rest
 * (sparklines, dials, thermometers, podiums) are hand-rolled because they
 * are bespoke compositions Recharts doesn't ship presets for.
 */
export default function StatsPage() {
  const t = useT();
  const me = useMe();
  const stats = useMyStats();

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  if (stats.isLoading) {
    return (
      <AppShell>
        <div className="text-center py-32 text-[var(--color-ivoire-soft)] italic">
          …
        </div>
      </AppShell>
    );
  }

  const data = stats.data;
  const empty = !data || data.total_pieces === 0;

  return (
    <AppShell>
      <main className="relative max-w-6xl mx-auto px-6 py-12">
        {empty ? (
          <>
            <TitlePage data={null} t={t} year={new Date().getFullYear()} />
            <Card className="p-10 text-center mt-12">
              <p className="text-[var(--color-ivoire-soft)] italic">
                {t("stats.empty")}
              </p>
            </Card>
          </>
        ) : (
          <>
            {/* I — Title page */}
            <TitlePage data={data} t={t} year={new Date().getFullYear()} />

            {/* II — Dépenses */}
            <ChapterRule roman="II" label={t("stats.ch.spend")} kanji="財" />
            <div className="grid lg:grid-cols-[1.4fr_1fr] gap-8 items-start">
              <SpendLedger data={data} t={t} />
              <PreorderDial data={data} t={t} />
            </div>

            {/* III — Répartition */}
            <ChapterRule roman="III" label={t("stats.ch.allocation")} kanji="分" />
            <div className="grid lg:grid-cols-2 gap-8">
              <PolarBreakdown
                title={t("stats.by_type.title")}
                kanji="像"
                rows={data.by_type.map((r) => ({
                  key: r.figure_type,
                  label: t(`type.${r.figure_type}`, { default: r.figure_type }),
                  count: Number(r.count) || 0,
                }))}
              />
              <PolarBreakdown
                title={t("stats.by_condition.title")}
                kanji="態"
                rows={data.by_condition.map((r) => ({
                  key: r.condition,
                  label: t(`condition.${r.condition}`, { default: r.condition }),
                  count: Number(r.count) || 0,
                }))}
              />
            </div>

            {/* IV — Palmarès */}
            <ChapterRule roman="IV" label={t("stats.ch.tops")} kanji="冠" />
            <div className="grid lg:grid-cols-3 gap-8">
              <PodiumColumn
                title={t("stats.top_manufacturers.title")}
                rows={data.top_manufacturers}
                t={t}
              />
              <PodiumColumn
                title={t("stats.top_series.title")}
                rows={data.top_series}
                t={t}
              />
              <PodiumColumn
                title={t("stats.top_sculptors.title")}
                rows={data.top_sculptors}
                t={t}
              />
            </div>

            {/* V — Chronique */}
            <ChapterRule roman="V" label={t("stats.ch.timeline")} kanji="暦" />
            {data.acquisitions_by_year.length === 0 ? (
              <p className="text-center text-[var(--color-ivoire-soft)] py-12 italic">
                {t("stats.timeline.empty")}
              </p>
            ) : (
              <PressStrip data={data.acquisitions_by_year} t={t} />
            )}

            {/* VI — Pièces majeures */}
            <ChapterRule roman="VI" label={t("stats.ch.crown")} kanji="王" />
            <CrownPieces data={data} t={t} />

            {/* VII — Échelle des prix */}
            {data.price_distribution.length > 0 ? (
              <>
                <ChapterRule roman="VII" label={t("stats.ch.scale")} kanji="幅" />
                <PriceThermometers data={data} t={t} />
              </>
            ) : null}

            {/* Colophon — printed-book footer */}
            <Colophon t={t} pieces={data.total_pieces} year={new Date().getFullYear()} />
          </>
        )}
      </main>
    </AppShell>
  );
}

// =============================================================================
// Chapter rule — Roman numeral + label + kanji separator
// =============================================================================

function ChapterRule({ roman, label, kanji }) {
  return (
    <div
      className="chapter-rule reveal"
      style={{ "--i": 1 }}
      role="separator"
      aria-label={label}
    >
      <span className="chapter-rule-roman">{roman}.</span>
      <span className="chapter-rule-line" aria-hidden />
      <span className="chapter-rule-label">{label}</span>
      <span className="chapter-rule-line" aria-hidden />
      <span className="chapter-rule-kanji" aria-hidden>
        {kanji}
      </span>
    </div>
  );
}

// =============================================================================
// I — Title page
// =============================================================================

function TitlePage({ data, t, year }) {
  const pieces = data?.total_pieces ?? 0;
  return (
    <header className="relative grid grid-cols-[auto_1fr] gap-6 md:gap-12 items-center mb-6 min-h-[36vh]">
      {/* Backdrop kanji 数 (numbers / count) */}
      <span
        aria-hidden
        className="ja absolute right-0 -top-12 text-[26rem] leading-none text-[var(--color-or)]/8 select-none pointer-events-none hidden md:block"
      >
        数
      </span>

      <div className="vertical-tag reveal hidden md:block" style={{ "--i": 0 }}>
        {t("stats.vertical_tag")}
      </div>

      <div className="relative">
        <p className="micro reveal" style={{ "--i": 0 }}>
          {t("stats.subtitle")} · {t("stats.edition", { year })}
        </p>
        <h1
          className="display text-5xl md:text-7xl mt-4 text-[var(--color-ivoire)] leading-[0.9] reveal"
          style={{ "--i": 1 }}
        >
          {t("stats.title")}
        </h1>
        <p
          className="display italic text-xl md:text-2xl text-[var(--color-or-pale)]/80 mt-3 reveal"
          style={{ "--i": 2 }}
        >
          {t("stats.kicker")}
        </p>

        {/* The hero figure — massive embossed total piece count */}
        <div className="mt-8 reveal" style={{ "--i": 3 }}>
          <p className="label-mono mb-2">{t("stats.headline.pieces")}</p>
          <p className="figural-massive" data-value={pieces}>
            <CountUp value={pieces} duration={1400} />
          </p>
        </div>

        {/* Headline satellites — secondary counters in a tight row */}
        {data ? (
          <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-4 reveal" style={{ "--i": 4 }}>
            <Satellite kanji="種" label={t("stats.headline.types")} value={data.distinct_types} />
            <Satellite kanji="社" label={t("stats.headline.manufacturers")} value={data.distinct_manufacturers} />
            <Satellite kanji="作" label={t("stats.headline.series")} value={data.distinct_series} />
            <Satellite kanji="影" label={t("stats.headline.scans")} value={data.total_scans} />
          </div>
        ) : null}
      </div>
    </header>
  );
}

function Satellite({ kanji, label, value }) {
  return (
    <div className="relative border-l border-[var(--color-or)]/30 pl-4 py-1">
      <span
        aria-hidden
        className="ja absolute -top-2 right-2 text-3xl text-[var(--color-or)]/15 leading-none select-none"
      >
        {kanji}
      </span>
      <p className="label-mono">{label}</p>
      <p className="display text-3xl md:text-4xl text-[var(--color-or)] mt-1.5 leading-none">
        <CountUp value={Number(value) || 0} />
      </p>
    </div>
  );
}

// =============================================================================
// II — Spend ledger + Preorder dial
// =============================================================================

function SpendLedger({ data, t }) {
  // We have acquisitions_by_year but not spend-by-year. The sparkline below
  // uses the year acquisition shape (clipped to the last ~8 years) as a soft
  // proxy for "buying intensity" — labelled as such, not as money over time.
  const yearProxy = useMemo(
    () => (data.acquisitions_by_year ?? []).slice(-8),
    [data.acquisitions_by_year],
  );
  return (
    <Card className="relative p-7">
      <p className="micro mb-1">{t("stats.spend.title")}</p>
      <p className="display italic text-[var(--color-or-pale)] text-lg mb-5">
        {t("stats.spend.kicker")}
      </p>

      {data.spend_by_currency.length === 0 ? (
        <p className="text-[var(--color-ivoire-soft)] italic">
          {t("stats.spend.empty")}
        </p>
      ) : (
        <ul className="-mt-1">
          {data.spend_by_currency.map((s) => (
            <SpendRow
              key={s.currency}
              row={s}
              yearProxy={yearProxy}
              t={t}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

/** One ledger row: brass tab, big grand-total figure, breakdown captions
 *  (item vs shipping), and a delta-vs-catalog tag when the difference is
 *  large enough to be interesting. */
function SpendRow({ row, yearProxy, t }) {
  const grand = Number(row.grand_total ?? row.total) || 0;
  const item = Number(row.total) || 0;
  const shipping = Number(row.shipping_total) || 0;
  const catalog = Number(row.catalog_total) || 0;
  const hasShipping = shipping > 0.005;
  const hasCatalog = catalog > 0.005;
  // Delta compares the *figure cost only* (`item`) against the catalog
  // MSRP. Mixing in shipping here would always look like overpaying
  // since shipping is non-negative — the user would never see a "saved"
  // chip even when they grabbed a piece on promo.
  const delta = hasCatalog ? item - catalog : 0;
  const deltaPct = hasCatalog && catalog > 0 ? (delta / catalog) * 100 : 0;
  const showDelta = hasCatalog && Math.abs(delta) > 0.01;

  return (
    <li className="ledger-row">
      <span className="brass-tab">{row.currency}</span>
      <div className="min-w-0">
        <p className="ledger-figure">{fmtMoney(grand, row.currency)}</p>
        <p className="ledger-caption mt-1">
          {t("stats.spend.priced_pieces", { count: row.pieces_priced })}
        </p>
        {/* Breakdown — item + shipping + catalog reference */}
        {hasShipping || hasCatalog ? (
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 max-w-xs text-[10.5px]">
            <Bd label={t("stats.spend.row.item")} value={fmtMoney(item, row.currency)} currency={row.currency} />
            {hasShipping ? (
              <Bd label={t("stats.spend.row.shipping")} value={fmtMoney(shipping, row.currency)} currency={row.currency} />
            ) : null}
            {hasCatalog ? (
              <Bd label={t("stats.spend.row.catalog")} value={fmtMoney(catalog, row.currency)} currency={row.currency} dim />
            ) : null}
          </dl>
        ) : null}
        {showDelta ? (
          <p
            className={`mt-2 inline-flex items-center text-[10px] uppercase tracking-[0.22em] border px-2 py-0.5 ${
              delta > 0
                ? "border-[var(--color-laque-bright)]/60 text-[var(--color-laque-bright)]"
                : "border-[var(--color-or)]/60 text-[var(--color-or)]"
            }`}
          >
            {delta > 0
              ? t("stats.spend.over_catalog", {
                  amount: fmtMoney(Math.abs(delta), row.currency),
                  currency: row.currency,
                  pct: deltaPct.toFixed(0),
                })
              : t("stats.spend.under_catalog", {
                  amount: fmtMoney(Math.abs(delta), row.currency),
                  currency: row.currency,
                  pct: Math.abs(deltaPct).toFixed(0),
                })}
          </p>
        ) : null}
      </div>
      <div className="w-28 hidden md:block">
        {yearProxy.length > 1 ? <Sparkline data={yearProxy} /> : null}
      </div>
    </li>
  );
}

/** Tiny breakdown row inside the ledger entry */
function Bd({ label, value, currency, dim = false }) {
  return (
    <>
      <dt
        className={`uppercase tracking-[0.18em] text-[9.5px] ${
          dim ? "text-[var(--color-ivoire-soft)]/55" : "text-[var(--color-or-pale)]/80"
        }`}
      >
        {label}
      </dt>
      <dd
        className={`font-mono ${
          dim
            ? "text-[var(--color-ivoire-soft)]/70"
            : "text-[var(--color-ivoire)]"
        }`}
      >
        {value} <span className="text-[var(--color-or-pale)]/50">{currency}</span>
      </dd>
    </>
  );
}

function Sparkline({ data }) {
  const w = 110;
  const h = 28;
  const max = Math.max(1, ...data.map((d) => Number(d.count) || 0));
  const min = 0;
  const stepX = data.length > 1 ? w / (data.length - 1) : 0;
  const points = data.map((d, i) => {
    const x = i * stepX;
    const y = h - ((Number(d.count) - min) / (max - min || 1)) * h;
    return [x, y];
  });
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
    .join(" ");
  const last = points[points.length - 1];
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={path} />
      {last ? <circle cx={last[0]} cy={last[1]} r="2" /> : null}
    </svg>
  );
}

function PreorderDial({ data, t }) {
  const p = data.preorders;
  const total = (p.placed || 0) + (p.received || 0) + (p.cancelled || 0);
  // four-row inventory table style — same brass tab, terse caption.
  const rows = [
    { kanji: "予", label: t("stats.preorders.placed"), value: p.placed, tone: "ivory" },
    { kanji: "途", label: t("stats.preorders.open"), value: p.open, tone: "gold" },
    { kanji: "受", label: t("stats.preorders.received"), value: p.received, tone: "gold-pale" },
    { kanji: "棄", label: t("stats.preorders.cancelled"), value: p.cancelled, tone: "dim" },
  ];
  return (
    <Card className="relative p-7 overflow-hidden">
      <p className="micro mb-1">{t("stats.preorders.title")}</p>
      <p className="display italic text-[var(--color-or-pale)] text-lg mb-5">
        {t("stats.preorders.kicker")}
      </p>

      <ul className="space-y-3">
        {rows.map((r) => (
          <li
            key={r.label}
            className="flex items-baseline gap-4 py-2 border-b border-dashed border-[var(--color-or)]/15 last:border-b-0"
          >
            <span
              aria-hidden
              className="ja text-2xl leading-none text-[var(--color-or)]/40 w-8 shrink-0"
            >
              {r.kanji}
            </span>
            <span className="display text-3xl leading-none tracking-tight">
              <span className={toneColor(r.tone)}>
                <CountUp value={Number(r.value) || 0} />
              </span>
            </span>
            <span className="micro flex-1 text-right truncate">{r.label}</span>
          </li>
        ))}
      </ul>
      {total > 0 ? (
        <p className="micro-tight mt-5 text-center opacity-70">
          {t("stats.preorders.cumul", { n: total })}
        </p>
      ) : null}
    </Card>
  );
}

function toneColor(tone) {
  switch (tone) {
    case "gold": return "text-[var(--color-or)]";
    case "gold-pale": return "text-[var(--color-or-pale)]";
    case "dim": return "text-[var(--color-ivoire-soft)]/60";
    case "ivory":
    default: return "text-[var(--color-ivoire)]";
  }
}

// =============================================================================
// III — Polar breakdown (donut + radial bars)
// =============================================================================

function PolarBreakdown({ title, kanji, rows }) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  const top = [...rows].sort((a, b) => b.count - a.count)[0];
  if (rows.length === 0) {
    return (
      <Card className="p-7">
        <p className="micro mb-4">{title}</p>
        <p className="text-[var(--color-ivoire-soft)] italic">—</p>
      </Card>
    );
  }
  return (
    <Card className="relative p-7">
      <p className="micro mb-5">{title}</p>
      <div className="grid grid-cols-[170px_1fr] gap-7 items-center">
        <PolarChart rows={rows} kanji={kanji} />
        <ol className="space-y-2.5">
          {rows.map((r, i) => {
            const share = total > 0 ? (r.count / total) * 100 : 0;
            return (
              <li key={r.key} className="flex items-baseline gap-3 text-sm">
                <span
                  className="block w-2 h-2 shrink-0 mt-1"
                  style={{
                    background: segmentColor(i, rows.length),
                  }}
                />
                <span className="flex-1 text-[var(--color-ivoire)] truncate">
                  {r.label}
                </span>
                <span className="font-mono text-[11px] text-[var(--color-or-pale)] tracking-wider">
                  {r.count}
                </span>
                <span className="font-mono text-[10px] text-[var(--color-ivoire-soft)]/60 w-10 text-right">
                  {share.toFixed(0)}%
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      {top ? (
        <p className="absolute top-7 right-7 text-right">
          <span className="micro-tight block">{rows.length > 1 ? "Dominant" : "Unique"}</span>
          <span className="display italic text-base text-[var(--color-or-pale)]">
            {top.label}
          </span>
        </p>
      ) : null}
    </Card>
  );
}

/** Donut breakdown — Recharts PieChart in donut configuration.
 *
 * Hand-rolling the SVG (wedges + arcs + even-odd full-circle special case)
 * was fragile: the 1-category case lost a chunk, the 2-category case
 * looked like two separate crescents. Recharts handles all the edge
 * cases (single segment closing to a full ring, equal halves, paddings)
 * correctly out of the box, costs ~70 KB gzipped, tree-shakes to just
 * PieChart + Pie + Cell.
 *
 * The kanji is positioned in the centre via the PieChart's
 * `label`-on-the-pie centerpoint trick: an absolutely-positioned span
 * inside the wrapper sits exactly at the donut's inner-ring centre.
 */
function PolarChart({ rows, kanji }) {
  const size = 170;
  const data = rows.map((r, i) => ({
    name: r.label,
    value: r.count,
    fill: segmentColor(i, rows.length),
  }));

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <RechartsPieChart width={size} height={size}>
        <RechartsPie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={26}
          outerRadius={size / 2 - 8}
          // Tiny 1° padding between wedges. Recharts also renders a clean
          // full ring when there's only one segment — no special case needed.
          paddingAngle={data.length > 1 ? 1 : 0}
          dataKey="value"
          isAnimationActive={false}
          stroke="transparent"
        >
          {data.map((entry, i) => (
            <RechartsCell key={i} fill={entry.fill} />
          ))}
        </RechartsPie>
        <RechartsTooltip
          contentStyle={{
            background: "oklch(0.10 0.005 50 / 0.95)",
            border: "1px solid oklch(0.78 0.10 80 / 0.4)",
            borderRadius: 0,
            color: "var(--color-ivoire)",
            fontSize: "12px",
            padding: "6px 10px",
          }}
          itemStyle={{ color: "var(--color-ivoire)" }}
          labelStyle={{ color: "var(--color-or-pale)" }}
          formatter={(value, name) => [`${value}`, name]}
        />
      </RechartsPieChart>
      {/* Centre kanji — positioned absolutely over the donut hole. */}
      <span
        aria-hidden
        className="ja absolute inset-0 grid place-items-center text-[22px] text-[var(--color-or)] pointer-events-none"
        style={{ opacity: 0.85 }}
      >
        {kanji}
      </span>
    </div>
  );
}

/** Six tiers of gold opacity so each segment is distinguishable without
 *  introducing colour outside the Vitrine palette. */
function segmentColor(i, n) {
  const opacities = [0.95, 0.78, 0.62, 0.48, 0.36, 0.26, 0.20, 0.16, 0.13, 0.10];
  const o = opacities[i] ?? 0.1;
  return `oklch(0.78 0.10 80 / ${o})`;
}

// =============================================================================
// IV — Podium of tops
// =============================================================================

function PodiumColumn({ title, rows, t }) {
  if (!rows || rows.length === 0) {
    return (
      <Card className="p-7">
        <p className="micro mb-4">{title}</p>
        <p className="text-[var(--color-ivoire-soft)] italic">
          {t("stats.top.empty")}
        </p>
      </Card>
    );
  }
  const podium = rows.slice(0, 3);
  const rest = rows.slice(3, 10);
  return (
    <div>
      <p className="micro mb-4">{title}</p>
      <div className="grid grid-cols-3 gap-1.5 items-end">
        {/* Reorder for visual hierarchy: 2 · 1 · 3 (silver in the middle of
         *  the screen looks weird; we keep 1·2·3 left-to-right so it reads
         *  like a list, with #1 visually elevated through extra padding) */}
        {podium.map((r, i) => (
          <div
            key={`${r.name}-${i}`}
            className={`podium-tier ${i === 0 ? "podium-tier--gold" : ""}`}
            style={{
              transform: i === 0 ? "translateY(-8px)" : "translateY(0)",
            }}
          >
            <span className="podium-rank">{String(i + 1).padStart(2, "0")}</span>
            <span className="podium-name" title={r.name}>
              {truncate(r.name, 36)}
            </span>
            <span className="podium-count">
              {r.count} {r.count === 1 ? "fig." : "fig."}
            </span>
          </div>
        ))}
      </div>

      {rest.length > 0 ? (
        <ol className="mt-5 space-y-1.5">
          {rest.map((r, idx) => (
            <li
              key={`${r.name}-${idx}`}
              className="flex items-baseline gap-3 text-[13px]"
            >
              <span className="font-mono text-[10px] text-[var(--color-or)]/40 w-5 shrink-0">
                {String(idx + 4).padStart(2, "0")}
              </span>
              <span className="flex-1 text-[var(--color-ivoire-soft)] truncate">
                {r.name}
              </span>
              <span className="font-mono text-[10.5px] text-[var(--color-or-pale)] shrink-0">
                {r.count}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function truncate(s, max) {
  if (!s || s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

// =============================================================================
// V — Press strip (year timeline)
// =============================================================================

function PressStrip({ data, t }) {
  const max = Math.max(1, ...data.map((d) => Number(d.count) || 0));
  return (
    <div className="press-strip reveal" style={{ "--i": 1 }}>
      <div
        className="press-grid"
        style={{
          gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))`,
        }}
      >
        {data.map((d, i) => {
          const h = ((Number(d.count) || 0) / max) * 100;
          return (
            <div key={d.year} className="press-col">
              <span className="press-count">{d.count}</span>
              <div
                className="press-bar"
                style={{
                  height: `${h}%`,
                  animationDelay: `${i * 60}ms`,
                }}
              />
              <span className="press-year">{d.year}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-12 text-center text-[10px] uppercase tracking-[0.32em] text-[var(--color-or-pale)]/70">
        {t("stats.timeline.caption")}
      </p>
    </div>
  );
}

// =============================================================================
// VI — Crown piece (most expensive)
// =============================================================================

function CrownPieces({ data, t }) {
  if (data.most_expensive.length === 0) {
    return (
      <p className="text-center text-[var(--color-ivoire-soft)] italic py-8">
        {t("stats.most_expensive.empty")}
      </p>
    );
  }
  return (
    <div className="grid lg:grid-cols-2 gap-6">
      {data.most_expensive.map((m, i) => (
        <article key={`${m.currency}-${m.figure_id}`} className="crown-card">
          <p className="crown-eyebrow">
            {t("stats.most_expensive.eyebrow")} · {m.currency}
          </p>
          <h3 className="display text-3xl md:text-4xl text-[var(--color-ivoire)] mt-3 leading-tight">
            <Link
              to={`/figures/${m.figure_id}`}
              className="hover:text-[var(--color-or-pale)] transition-colors"
            >
              {m.figure_name}
            </Link>
          </h3>
          <div className="gold-rule w-12 mt-5 mb-4 opacity-70" />
          <p className="display font-light text-4xl md:text-5xl text-[var(--color-or)]">
            {fmtMoney(m.price, m.currency)}
            <span className="font-mono text-base text-[var(--color-or-pale)]/70 ml-3 align-baseline">
              {m.currency}
            </span>
          </p>
          {m.purchase_date ? (
            <p className="micro-tight mt-5">
              {t("stats.most_expensive.acquired")} ·{" "}
              <time dateTime={m.purchase_date}>
                {new Date(m.purchase_date).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </time>
            </p>
          ) : null}
          <span
            aria-hidden
            className="absolute bottom-4 right-5 font-mono text-[9px] tracking-[0.3em] uppercase text-[var(--color-or-pale)]/40"
          >
            n<sup>o</sup> {i + 1}
          </span>
        </article>
      ))}
    </div>
  );
}

// =============================================================================
// VII — Thermomètre (price distribution)
// =============================================================================

function PriceThermometers({ data, t }) {
  return (
    <div className="space-y-12">
      {data.price_distribution.map((p) => (
        <PriceThermometer key={p.currency} dist={p} t={t} />
      ))}
    </div>
  );
}

function PriceThermometer({ dist, t }) {
  const min = Number(dist.min) || 0;
  const max = Number(dist.max) || 1;
  const med = Number(dist.median) || 0;
  const avg = Number(dist.avg) || 0;
  const span = max - min || 1;
  const pos = (v) => ((v - min) / span) * 100;

  const marks = [
    { key: "min", value: min, x: 0, label: t("stats.price_dist.min") },
    { key: "median", value: med, x: pos(med), label: t("stats.price_dist.median") },
    { key: "avg", value: avg, x: pos(avg), label: t("stats.price_dist.avg") },
    { key: "max", value: max, x: 100, label: t("stats.price_dist.max") },
  ];

  return (
    <Card className="p-7">
      <div className="flex items-baseline justify-between mb-2">
        <p className="micro">{t("stats.price_dist.title")}</p>
        <span className="brass-tab">{dist.currency}</span>
      </div>
      <div className="thermo">
        <span className="thermo-rule" aria-hidden />
        {marks.map((m) => (
          <span
            key={m.key}
            className="thermo-mark"
            style={{ left: `${m.x}%` }}
          >
            <span className="thermo-mark-value">
              {fmtMoney(m.value, dist.currency)}
            </span>
            <span className="thermo-mark-dot" aria-hidden />
            <span className="thermo-mark-label">{m.label}</span>
          </span>
        ))}
      </div>
    </Card>
  );
}

// =============================================================================
// Colophon — printed-book footer
// =============================================================================

function Colophon({ t, pieces, year }) {
  return (
    <footer className="mt-20 pt-8 border-t border-[var(--color-or)]/15 text-center">
      <p className="display italic text-sm text-[var(--color-or-pale)]/60">
        {t("stats.colophon.composed", { pieces, year })}
      </p>
      <p className="micro-tight mt-2 opacity-70">{t("stats.colophon.signoff")}</p>
    </footer>
  );
}

// =============================================================================
// Helpers
// =============================================================================

const ZERO_DECIMALS = new Set(["JPY", "KRW", "VND", "IDR"]);

function fmtMoney(raw, currency) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return "—";
  const maxFrac = ZERO_DECIMALS.has(currency) ? 0 : 2;
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac,
  });
}

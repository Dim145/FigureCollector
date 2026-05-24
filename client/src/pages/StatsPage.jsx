import { Link, Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useMyStats } from "../hooks/useStats.js";
import AppShell from "../components/AppShell.jsx";
import Card from "../components/Card.jsx";
import CountUp from "../components/CountUp.jsx";

/**
 * Direction B — Statistics page. Whole-collection breakdowns inspired by
 * MangaCollector's "Profile / Statistics": spend by currency, distribution
 * by type / condition, top manufacturers / series / sculptors, acquisitions
 * timeline by year, most expensive piece, price distribution.
 *
 * Charts are CSS-only (horizontal bar segments + a vertical year bar chart),
 * keeping the bundle slim and the aesthetic restrained — gold leaf, ivory,
 * laque accents only.
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
        <div className="text-center py-16 text-[var(--color-ivoire-soft)]">…</div>
      </AppShell>
    );
  }

  const data = stats.data;
  const empty = !data || data.total_pieces === 0;

  return (
    <AppShell>
      <main className="max-w-6xl mx-auto px-6 py-12">
        <Header t={t} />

        {empty ? (
          <Card className="p-10 text-center">
            <p className="text-[var(--color-ivoire-soft)]">{t("stats.empty")}</p>
          </Card>
        ) : (
          <>
            <Headlines data={data} t={t} />

            <div className="gold-rule mx-auto w-56 my-12" />

            <div className="grid md:grid-cols-2 gap-6">
              <SpendTile data={data} t={t} />
              <PreordersTile data={data} t={t} />
            </div>

            <div className="gold-rule mx-auto w-56 my-12" />

            <div className="grid md:grid-cols-2 gap-6">
              <BarsTile
                title={t("stats.by_type.title")}
                rows={data.by_type.map((r) => ({
                  key: r.figure_type,
                  label: t(`type.${r.figure_type}`, { default: r.figure_type }),
                  count: r.count,
                }))}
                total={data.total_pieces}
              />
              <BarsTile
                title={t("stats.by_condition.title")}
                rows={data.by_condition.map((r) => ({
                  key: r.condition,
                  label: t(`condition.${r.condition}`, { default: r.condition }),
                  count: r.count,
                }))}
                total={data.total_pieces}
              />
            </div>

            <div className="gold-rule mx-auto w-56 my-12" />

            <div className="grid md:grid-cols-3 gap-6">
              <TopTile title={t("stats.top_manufacturers.title")} rows={data.top_manufacturers} t={t} />
              <TopTile title={t("stats.top_series.title")} rows={data.top_series} t={t} />
              <TopTile title={t("stats.top_sculptors.title")} rows={data.top_sculptors} t={t} />
            </div>

            <div className="gold-rule mx-auto w-56 my-12" />

            <section>
              <h3 className="micro mb-4 text-center">{t("stats.timeline.title")}</h3>
              {data.acquisitions_by_year.length === 0 ? (
                <p className="text-center text-[var(--color-ivoire-soft)]">
                  {t("stats.timeline.empty")}
                </p>
              ) : (
                <YearTimeline data={data.acquisitions_by_year} />
              )}
            </section>

            <div className="gold-rule mx-auto w-56 my-12" />

            <div className="grid md:grid-cols-2 gap-6">
              <MostExpensiveTile data={data} t={t} />
              <PriceDistTile data={data} t={t} />
            </div>
          </>
        )}
      </main>
    </AppShell>
  );
}

// -----------------------------------------------------------------------------

function Header({ t }) {
  return (
    <header className="text-center mb-10 relative">
      <p className="micro">{t("stats.subtitle")}</p>
      <div className="relative inline-block mt-3">
        <p
          aria-hidden
          className="absolute inset-0 ja text-[10rem] md:text-[14rem] leading-none text-[var(--color-or)]/12 select-none -translate-y-6 md:-translate-y-12"
          style={{ filter: "blur(0.4px)" }}
        >
          数
        </p>
        <h1 className="relative display text-5xl md:text-6xl text-[var(--color-ivoire)]">
          {t("stats.title")}
        </h1>
      </div>
      <div className="gold-rule mx-auto w-32 mt-6" />
    </header>
  );
}

function Headlines({ data, t }) {
  const items = [
    { value: data.total_pieces, label: t("stats.headline.pieces") },
    { value: data.distinct_types, label: t("stats.headline.types") },
    { value: data.distinct_manufacturers, label: t("stats.headline.manufacturers") },
    { value: data.distinct_series, label: t("stats.headline.series") },
    { value: data.total_scans, label: t("stats.headline.scans") },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
      {items.map((it) => (
        <Card
          key={it.label}
          className="p-5 text-center magnetic shimmer glass"
        >
          <p className="figural-xl text-5xl md:text-6xl text-[var(--color-or)]">
            <CountUp value={Number(it.value) || 0} />
          </p>
          <p className="label-mono mt-3">{it.label}</p>
        </Card>
      ))}
    </div>
  );
}

function SpendTile({ data, t }) {
  return (
    <Card className="p-6">
      <p className="micro mb-4">{t("stats.spend.title")}</p>
      {data.spend_by_currency.length === 0 ? (
        <p className="text-[var(--color-ivoire-soft)]">{t("stats.spend.empty")}</p>
      ) : (
        <ul className="space-y-3">
          {data.spend_by_currency.map((s) => (
            <li key={s.currency} className="flex justify-between items-baseline">
              <span className="font-mono text-[var(--color-ivoire-soft)] tracking-wider text-sm">
                {s.currency}
              </span>
              <span className="text-right">
                <span className="display text-2xl text-[var(--color-or-pale)]">
                  {fmtMoney(s.total, s.currency)}
                </span>
                <span className="block micro opacity-70">
                  {t("stats.spend.priced_pieces", { count: s.pieces_priced })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function PreordersTile({ data, t }) {
  const p = data.preorders;
  return (
    <Card className="p-6">
      <p className="micro mb-4">{t("stats.preorders.title")}</p>
      <ul className="grid grid-cols-2 gap-4">
        <Stat label={t("stats.preorders.placed")} value={p.placed} accent="ivoire" />
        <Stat label={t("stats.preorders.open")} value={p.open} accent="or" />
        <Stat label={t("stats.preorders.received")} value={p.received} accent="or-pale" />
        <Stat label={t("stats.preorders.cancelled")} value={p.cancelled} accent="dim" />
      </ul>
    </Card>
  );
}

function Stat({ label, value, accent }) {
  const colors = {
    ivoire: "text-[var(--color-ivoire)]",
    or: "text-[var(--color-or)]",
    "or-pale": "text-[var(--color-or-pale)]",
    dim: "text-[var(--color-ivoire-soft)]/70",
  };
  return (
    <li>
      <p className={`display text-3xl leading-none ${colors[accent] ?? colors.ivoire}`}>{value}</p>
      <p className="micro mt-1">{label}</p>
    </li>
  );
}

function BarsTile({ title, rows, total }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Card className="p-6">
      <p className="micro mb-4">{title}</p>
      {rows.length === 0 ? (
        <p className="text-[var(--color-ivoire-soft)]">—</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const pct = (r.count / max) * 100;
            const share = total > 0 ? ((r.count / total) * 100).toFixed(1) : "0";
            return (
              <li key={r.key}>
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-sm text-[var(--color-ivoire)]">{r.label}</span>
                  <span className="font-mono text-[11px] text-[var(--color-or-pale)]">
                    {r.count} <span className="opacity-50">· {share}%</span>
                  </span>
                </div>
                <div className="h-1.5 bg-[var(--color-or)]/10 relative overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-[var(--color-or)]/70 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function TopTile({ title, rows, t }) {
  return (
    <Card className="p-6">
      <p className="micro mb-4">{title}</p>
      {rows.length === 0 ? (
        <p className="text-[var(--color-ivoire-soft)]">{t("stats.top.empty")}</p>
      ) : (
        <ol className="space-y-2">
          {rows.map((r, i) => (
            <li key={`${r.name}-${i}`} className="flex items-baseline gap-3">
              <span className="font-mono text-[10px] text-[var(--color-or)]/60 w-4 shrink-0">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="flex-1 text-[var(--color-ivoire)] truncate" title={r.name}>
                {r.name}
              </span>
              <span className="font-mono text-[11px] text-[var(--color-or-pale)] shrink-0">
                {r.count}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function YearTimeline({ data }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div
      className="grid gap-2 h-40 items-end"
      style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}
    >
      {data.map((d) => (
        <div key={d.year} className="flex flex-col items-center justify-end h-full">
          <div className="relative w-full" style={{ height: `${(d.count / max) * 100}%` }}>
            <div className="absolute inset-x-0 bottom-0 top-0 bg-[var(--color-or)]/70 hover:bg-[var(--color-or)] transition-colors" />
            <span className="absolute -top-5 left-1/2 -translate-x-1/2 font-mono text-[10px] text-[var(--color-or-pale)]">
              {d.count}
            </span>
          </div>
          <span className="micro mt-2 opacity-70">{d.year}</span>
        </div>
      ))}
    </div>
  );
}

function MostExpensiveTile({ data, t }) {
  return (
    <Card className="p-6">
      <p className="micro mb-4">{t("stats.most_expensive.title")}</p>
      {data.most_expensive.length === 0 ? (
        <p className="text-[var(--color-ivoire-soft)]">{t("stats.most_expensive.empty")}</p>
      ) : (
        <ul className="space-y-4">
          {data.most_expensive.map((m) => (
            <li
              key={`${m.currency}-${m.figure_id}`}
              className="border-l-2 border-[var(--color-or)]/40 pl-4"
            >
              <p className="display text-xl text-[var(--color-ivoire)] leading-tight">
                <Link
                  to={`/figures/${m.figure_id}`}
                  className="hover:text-[var(--color-or-pale)] transition-colors"
                >
                  {m.figure_name}
                </Link>
              </p>
              <p className="font-mono text-sm text-[var(--color-or)] mt-1">
                {fmtMoney(m.price, m.currency)}{" "}
                <span className="text-[var(--color-ivoire-soft)] tracking-wider">
                  {m.currency}
                </span>
              </p>
              {m.purchase_date ? (
                <p className="micro mt-1 opacity-70">
                  {new Date(m.purchase_date).toLocaleDateString()}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function PriceDistTile({ data, t }) {
  return (
    <Card className="p-6">
      <p className="micro mb-4">{t("stats.price_dist.title")}</p>
      {data.price_distribution.length === 0 ? (
        <p className="text-[var(--color-ivoire-soft)]">—</p>
      ) : (
        <div className="space-y-5">
          {data.price_distribution.map((p) => (
            <div key={p.currency}>
              <p className="font-mono text-xs tracking-wider text-[var(--color-or-pale)] mb-2">
                {p.currency}
              </p>
              <dl className="grid grid-cols-4 gap-2 text-center">
                <PriceCell label={t("stats.price_dist.min")} value={fmtMoney(p.min, p.currency)} />
                <PriceCell
                  label={t("stats.price_dist.median")}
                  value={fmtMoney(p.median, p.currency)}
                />
                <PriceCell label={t("stats.price_dist.avg")} value={fmtMoney(p.avg, p.currency)} />
                <PriceCell label={t("stats.price_dist.max")} value={fmtMoney(p.max, p.currency)} />
              </dl>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function PriceCell({ label, value }) {
  return (
    <div>
      <dt className="micro text-[10px]">{label}</dt>
      <dd className="font-mono text-sm text-[var(--color-ivoire)] mt-1">{value}</dd>
    </div>
  );
}

// -----------------------------------------------------------------------------

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

import AccentTitle from "../../components/AccentTitle.jsx";
import CountUp from "../../components/CountUp.jsx";
import StatCard from "../../components/StatCard.jsx";

/**
 * I — Frontispiece. The almanac's title page: vertical tag, backdrop 数 kanji,
 * the signature red AccentTitle, a massive embossed piece count, then the
 * headline totals as shared <StatCard>s (types · fabricants · séries · scans).
 *
 * The `.reveal` stagger is CSS-driven (`--i`); it self-disables under
 * prefers-reduced-motion via the shared rule in index.css.
 */
export default function StatsTitlePage({ data, t, year }) {
  const pieces = data?.total_pieces ?? 0;
  return (
    <header className="relative grid grid-cols-[auto_1fr] gap-6 md:gap-12 items-center mb-6 min-h-[34vh]">
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
          <AccentTitle text={t("stats.title")} />
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
          <p className="figural-massive">
            <CountUp value={pieces} duration={1400} />
          </p>
        </div>

        {/* Headline totals — shared StatCards (gold value tone). */}
        {data ? (
          <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-3 reveal" style={{ "--i": 4 }}>
            <StatCard
              label={t("stats.headline.types")}
              value={Number(data.distinct_types) || 0}
              tone="gold"
            />
            <StatCard
              label={t("stats.headline.manufacturers")}
              value={Number(data.distinct_manufacturers) || 0}
              tone="gold"
            />
            <StatCard
              label={t("stats.headline.series")}
              value={Number(data.distinct_series) || 0}
              tone="gold"
            />
            <StatCard
              label={t("stats.headline.scans")}
              value={Number(data.total_scans) || 0}
              tone="gold"
            />
          </div>
        ) : null}
      </div>
    </header>
  );
}

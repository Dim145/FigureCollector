import StatCard from "../../components/StatCard.jsx";
import Money from "../../components/Money.jsx";
import CountUp from "../../components/CountUp.jsx";
import AccentTitle from "../../components/AccentTitle.jsx";
import Reveal from "../../components/motion/Reveal.jsx";
import { mix, ACCENT_GOLD } from "./shared.jsx";

/**
 * Frontispiece — the editorial opening of the recap: a one-line display
 * sentence whose tally is lifted into gold, then a strip of headline
 * `StatCard`s (pieces · spend · favourite maker · peak month). The figurine
 * metrics only; gold carries value/spend, hanko-red carries losses, the rest
 * stay ivoire (StatCard's default tone).
 */
export default function Frontispiece({ data, t }) {
  const count = data.pieces_acquired;
  const spend = (data.spend_by_currency ?? [])[0] ?? null;
  const losses = (data.cancellation_losses ?? [])[0] ?? null;
  const fav = data.top_manufacturer;

  const months = data.monthly_pieces ?? [];
  let peakCount = 0;
  let peakMonth = 0;
  for (const m of months) {
    const c = Number(m.count) || 0;
    if (c > peakCount) {
      peakCount = c;
      peakMonth = m.month;
    }
  }

  // Opening sentence with the tally split out so it keeps its gold emphasis
  // inside the sentence flow rather than as a separate hero block.
  const phrase =
    count === 1
      ? t("yir.almanach.opening", { n: count })
      : t("yir.almanach.opening_many", { n: count });
  const parts = phrase.split(String(count));

  return (
    <section aria-labelledby="yir-frontispiece">
      <Reveal as="div" y={20}>
        {/* Red-accent statement — the signature A headline move. */}
        <h2
          id="yir-frontispiece"
          className="display text-2xl md:text-3xl text-[var(--on-surface)] leading-tight"
        >
          <AccentTitle
            text={t("yir.almanach.statement", {
              default: "Bilan d'une année de collection.",
            })}
          />
        </h2>
        <p className="display text-xl md:text-2xl leading-snug text-[var(--on-surface-muted)] mt-4">
          {parts[0]}
          {/* The headline count is the emotional centre — a value figure, so
              it reads in gold (金), never a status colour. */}
          <span className="figural text-[var(--color-or)] mx-1">
            <CountUp value={count} />
          </span>
          {parts[1]}
        </p>
        <div className="gold-rule w-16 mt-6" />
      </Reveal>

      <Reveal as="div" y={22} delay={0.05} className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label={t("yir.pieces.label")} value={count} />
        <StatCard
          label={t("yir.spend.label")}
          value={spend ? <Money amount={spend.total} currency={spend.currency} round /> : "—"}
          sub={spend ? spend.currency : t("yir.spend.empty")}
          tone="gold"
        />
        <StatCard
          label={t("yir.top_manufacturer.label")}
          value={fav ? fav.name : "—"}
          sub={
            fav
              ? t("yir.fav.count", {
                  count: Number(fav.count) || 0,
                  default: "× {count} pièces",
                })
              : "—"
          }
        />
        {losses ? (
          <StatCard
            label={t("yir.losses.label")}
            value={
              <>
                − <Money amount={losses.total} currency={losses.currency} round />
              </>
            }
            sub={losses.currency}
            tone="red"
          />
        ) : (
          <StatCard
            label={t("yir.timeline.peak")}
            value={peakCount}
            sub={
              peakMonth
                ? t(`yir.month.${peakMonth}`)
                : t("yir.peak.unit", { default: "pièces / mois" })
            }
          />
        )}
      </Reveal>

      {/* When losses bumped the peak out of the strip, surface it as a quiet
          aside so the high-water month is never lost. */}
      {losses && peakCount > 0 ? (
        <p
          className="micro-tight normal-case tracking-[0.18em] mt-3 text-[var(--on-surface-subtle)]"
          style={{ borderLeft: `2px solid ${mix(ACCENT_GOLD, 35)}`, paddingLeft: "0.6rem" }}
        >
          {t("yir.timeline.peak")} · {t(`yir.month.${peakMonth}`)} (
          <CountUp value={peakCount} />)
        </p>
      ) : null}
    </section>
  );
}

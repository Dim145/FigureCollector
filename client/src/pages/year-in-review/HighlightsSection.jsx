import Card from "../../components/Card.jsx";
import Money from "../../components/Money.jsx";
import CountUp from "../../components/CountUp.jsx";
import Reveal from "../../components/motion/Reveal.jsx";
import { EditorialChapter, mix, ACCENT_GOLD, ACCENT_RED, ACCENT_JADE } from "./shared.jsx";

/**
 * Highlights — the editorial chapters of the year:
 *   1. Dépenses (+ pertes sur annulations) — gold for spend, hanko-red losses.
 *   2. Favoris — paired jade cards (fabricant / série).
 *   3. Sortie la plus repoussée — a full-width hanko-red chapter (a loss of
 *      time), only when a slip exists.
 *
 * `top_manufacturer` / `top_series` / `longest_slip` carry only names + counts
 * (no figure ids or photos), so these are typographic cards, not `FigureCard`s.
 */
export default function HighlightsSection({ data, t }) {
  return (
    <>
      <SpendChapter data={data} t={t} />
      <FavouritesChapter data={data} t={t} />
      {data.longest_slip ? <SlipChapter slip={data.longest_slip} t={t} /> : null}
    </>
  );
}

function SpendChapter({ data, t }) {
  const spend = data.spend_by_currency ?? [];
  const losses = data.cancellation_losses ?? [];
  const hasSpend = spend.length > 0;
  const hasLosses = losses.length > 0;

  return (
    <EditorialChapter kicker={t("yir.spend.label")} kanji="銭" accent={ACCENT_GOLD}>
      {hasSpend ? (
        <ul className="space-y-2.5">
          {spend.map((s) => (
            <li
              key={s.currency}
              className="flex items-baseline justify-between gap-4 py-2 border-b border-dashed last:border-b-0"
              style={{ borderColor: mix(ACCENT_GOLD, 15) }}
            >
              <span className="micro-tight">{s.currency}</span>
              <span className="display text-3xl md:text-4xl leading-none text-[var(--color-or)]">
                <CountUp
                  value={Number(s.total)}
                  format={(n) => <Money amount={n} currency={s.currency} round />}
                />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[var(--on-surface-muted)] italic">{t("yir.spend.empty")}</p>
      )}

      {hasLosses ? (
        <div className="mt-6 pt-5 border-t" style={{ borderColor: mix(ACCENT_RED, 28) }}>
          <p className="micro-tight inline-flex items-center gap-2" style={{ color: ACCENT_RED }}>
            <span
              aria-hidden
              className="inline-block w-4 h-px"
              style={{ background: mix(ACCENT_RED, 75) }}
            />
            {t("yir.losses.label")}
          </p>
          <ul className="mt-2.5 space-y-2">
            {losses.map((s) => (
              <li key={`loss-${s.currency}`} className="flex items-baseline justify-between gap-4">
                <span className="micro-tight" style={{ color: ACCENT_RED }}>
                  {s.currency}
                </span>
                <span
                  className="display text-2xl md:text-3xl leading-none"
                  style={{ color: ACCENT_RED }}
                >
                  −{" "}
                  <CountUp
                    value={Number(s.total)}
                    format={(n) => <Money amount={n} currency={s.currency} round />}
                  />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </EditorialChapter>
  );
}

function FavouritesChapter({ data, t }) {
  const items = [
    { kicker: t("yir.top_manufacturer.label"), kanji: "工", entry: data.top_manufacturer },
    { kicker: t("yir.top_series.label"), kanji: "物", entry: data.top_series },
  ];
  return (
    <Reveal as="div" y={24} className="mt-8 grid md:grid-cols-2 gap-4">
      {items.map((it) => (
        <Card
          key={it.kanji}
          className="relative p-7 overflow-hidden"
          style={{ breakInside: "avoid" }}
        >
          <span
            aria-hidden
            className="ja absolute -top-3 right-4 text-[5.5rem] leading-none select-none pointer-events-none"
            style={{ color: mix(ACCENT_JADE, 12) }}
          >
            {it.kanji}
          </span>
          <p className="micro relative inline-flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block w-5 h-px"
              style={{ background: mix(ACCENT_JADE, 80) }}
            />
            {it.kicker}
          </p>
          {it.entry ? (
            <>
              <p
                className="display text-2xl md:text-3xl mt-4 leading-tight"
                style={{ color: ACCENT_JADE }}
              >
                {it.entry.name}
              </p>
              <p className="micro-tight mt-3 normal-case tracking-[0.18em]">
                ×{" "}
                <span className="figural text-base" style={{ color: ACCENT_JADE }}>
                  <CountUp value={Number(it.entry.count) || 0} />
                </span>{" "}
                {t("yir.fav.pieces", { default: "pièces" })}
              </p>
            </>
          ) : (
            <p className="text-[var(--on-surface-muted)] italic mt-4">—</p>
          )}
        </Card>
      ))}
    </Reveal>
  );
}

function SlipChapter({ slip, t }) {
  return (
    <EditorialChapter kicker={t("yir.longest_slip.label")} kanji="遅" accent={ACCENT_RED}>
      <p className="display text-2xl md:text-3xl leading-tight text-[var(--on-surface)]">
        {slip.figure_name}
      </p>
      <p className="mt-3 text-[var(--on-surface-muted)]">
        {slip.slip_count === 1
          ? t("yir.longest_slip.detail_one", {
              from: slip.original_date ?? "?",
              to: slip.current_date ?? "?",
            })
          : t("yir.longest_slip.detail", {
              slips: slip.slip_count,
              from: slip.original_date ?? "?",
              to: slip.current_date ?? "?",
            })}
      </p>
    </EditorialChapter>
  );
}

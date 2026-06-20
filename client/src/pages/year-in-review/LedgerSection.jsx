import CountUp from "../../components/CountUp.jsx";
import { EditorialChapter, mix, ACCENT_GOLD, ACCENT_JADE } from "./shared.jsx";

/**
 * Monthly ledger — the acquisitions timeline as a 12-month bar chart. CSS-only
 * heights (no JS animation, no canvas) so it stays GPU-light; the single
 * `Reveal` on the chapter handles the fade-in. Gold bars with a jade
 * high-water mark on the peak month; empty months read as a faint baseline
 * tick, not a zero-height bar.
 *
 * The chart sits in its own `overflow-x:auto` well so it never makes the page
 * side-scroll on narrow screens (it stays a clean 12-column grid down to
 * mobile, but the well is the safety net the KIT asks for).
 */
export default function LedgerSection({ data, t }) {
  const counts = new Array(12).fill(0);
  for (const m of data) {
    if (m.month >= 1 && m.month <= 12) counts[m.month - 1] = Number(m.count) || 0;
  }
  const max = Math.max(1, ...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  const peakMonth = counts.indexOf(max) + 1; // 1..12

  return (
    <EditorialChapter kicker={t("yir.timeline.title")} kanji="暦" accent={ACCENT_GOLD}>
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-1 mb-6">
        <span className="micro-tight normal-case tracking-[0.18em] text-[var(--on-surface-muted)]">
          {t("yir.timeline.peak")}{" "}
          {/* Peak month = the year's high-water mark — jade, so it pops out of
              the gold spend figures elsewhere. */}
          <span className="display text-base" style={{ color: ACCENT_JADE }}>
            {t(`yir.month.${peakMonth}`)} (<CountUp value={max} />)
          </span>
        </span>
        <span className="micro-tight normal-case tracking-[0.18em] text-[var(--on-surface-muted)]">
          {t("yir.timeline.total")}{" "}
          <span className="display text-base text-[var(--color-or-pale)]">
            <CountUp value={total} />
          </span>
        </span>
      </div>

      <div className="overflow-x-auto -mx-1 px-1">
        <div
          className="grid grid-cols-12 gap-1.5 md:gap-2 items-end h-44 min-w-[20rem]"
          role="img"
          aria-label={t("yir.timeline.aria", {
            total,
            peakMonth: t(`yir.month.${peakMonth}`),
            peak: max,
            default: "Pièces acquises par mois — {total} au total, pic en {peakMonth} ({peak}).",
          })}
        >
          {counts.map((c, i) => {
            const isPeak = c === max && c > 0;
            const isEmpty = c === 0;
            const heightPct = isEmpty ? 0 : Math.max(4, (c / max) * 100);
            return (
              <div key={i} className="flex flex-col items-center justify-end h-full min-w-0">
                {c > 0 ? (
                  <span
                    className="figural text-[11px] md:text-xs mb-1.5 leading-none"
                    style={{
                      color: isPeak ? ACCENT_JADE : "var(--color-or-pale)",
                    }}
                  >
                    {c}
                  </span>
                ) : null}
                <div className="relative w-full flex-1 flex items-end">
                  {isEmpty ? (
                    <span
                      aria-hidden
                      className="block w-full h-px"
                      style={{ background: mix(ACCENT_GOLD, 18) }}
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="block w-full rounded-t-[2px]"
                      style={{
                        height: `${heightPct}%`,
                        background: isPeak
                          ? `linear-gradient(180deg, ${ACCENT_JADE} 0%, ${mix(ACCENT_JADE, 50)} 100%)`
                          : `linear-gradient(180deg, ${mix(ACCENT_GOLD, 90)} 0%, ${mix(ACCENT_GOLD, 45)} 100%)`,
                      }}
                    />
                  )}
                </div>
                <span
                  className="micro-tight mt-2 normal-case tracking-[0.1em] text-[9px] truncate w-full text-center"
                  style={isPeak ? { color: ACCENT_JADE } : undefined}
                >
                  {t(`yir.month.${i + 1}`)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </EditorialChapter>
  );
}

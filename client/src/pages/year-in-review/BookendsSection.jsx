import Card from "../../components/Card.jsx";
import Reveal from "../../components/motion/Reveal.jsx";
import { appLocale } from "../../lib/locale.js";
import { mix, ACCENT_GOLD, ACCENT_JADE } from "./shared.jsx";

/**
 * Bookends — the first / last acquisition of the year. Jade opens the year,
 * gold closes it; the accent rides the top edge so the figure names stay
 * legible ivoire. `first` / `last` carry a name + timestamp only.
 */
export default function BookendsSection({ first, last, t }) {
  const cells = [
    first
      ? {
          eyebrow: t("yir.first_acquisition"),
          name: first.figure_name,
          at: first.at,
          accent: ACCENT_JADE,
        }
      : null,
    last
      ? {
          eyebrow: t("yir.last_acquisition"),
          name: last.figure_name,
          at: last.at,
          accent: ACCENT_GOLD,
        }
      : null,
  ].filter(Boolean);

  if (!cells.length) return null;

  return (
    <Reveal as="section" y={24} className="mt-8" aria-labelledby="yir-bookends">
      <p id="yir-bookends" className="micro inline-flex items-center gap-2 mb-4">
        <span
          aria-hidden
          className="inline-block w-5 h-px"
          style={{ background: mix(ACCENT_GOLD, 80) }}
        />
        {t("yir.bookends.title")}
        <span aria-hidden className="ja text-[var(--color-or-pale)]/70 ml-1">
          標
        </span>
      </p>
      <div className="grid md:grid-cols-2 gap-4">
        {cells.map((b) => (
          <Card
            key={b.eyebrow}
            className="relative p-7 overflow-hidden"
            style={{ breakInside: "avoid" }}
          >
            <span
              aria-hidden
              className="absolute top-0 left-0 right-0 h-[2px]"
              style={{ background: b.accent }}
            />
            <p className="micro-tight" style={{ color: b.accent }}>
              {b.eyebrow}
            </p>
            <p className="display text-2xl md:text-3xl mt-3 leading-tight text-[var(--on-surface)]">
              {b.name}
            </p>
            <time className="micro-tight mt-4 block normal-case tracking-[0.18em] text-[var(--on-surface-subtle)]">
              {new Date(b.at).toLocaleDateString(appLocale())}
            </time>
          </Card>
        ))}
      </div>
    </Reveal>
  );
}

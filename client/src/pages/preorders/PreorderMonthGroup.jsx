import Reveal from "../../components/motion/Reveal.jsx";
import PreorderEntry from "./PreorderEntry.jsx";

/**
 * One release-month section of the ledger: a kanji "月" marker sitting on the
 * gold spine, the localised month + year, and the month's entries threaded
 * beneath it. The spine + marker positioning live in the .horarium-* CSS.
 */
export default function PreorderMonthGroup({ month, t }) {
  return (
    <section>
      <Reveal as="header" y={14} amount={0.6} className="horarium-month">
        <span
          className="horarium-month-kanji"
          aria-hidden
          style={{
            color: "var(--color-indigo)",
            borderColor: "color-mix(in oklab, var(--color-indigo) 55%, transparent)",
            boxShadow: "0 0 18px -6px color-mix(in oklab, var(--color-indigo) 70%, transparent)",
          }}
        >
          月
        </span>
        <h2 className="horarium-month-label">{month.label}</h2>
        {month.year ? <span className="horarium-month-year">{month.year}</span> : null}
        {/* A short accent rule trailing off the month label — horizon + motion
         *  for an otherwise flat divider. Theme-var gradient, decorative. */}
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
        <PreorderEntry key={p.id} preorder={p} index={i} t={t} />
      ))}
    </section>
  );
}

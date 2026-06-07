import CountUp from "./CountUp.jsx";

/**
 * Direction A stat card — a hairline-bordered lozenge: a tiny mono label, a big
 * Fraunces number (count-up animated for numeric values), and an optional
 * sub-line. `tone` tints the number — gold for value, hanko-red for urgency,
 * ivoire by default. Shared by the Collection + Catalogue stat strips.
 */
export default function StatCard({ label, value, sub, tone }) {
  const numeric = typeof value === "number";
  const toneCls =
    tone === "gold"
      ? "text-[var(--color-or)]"
      : tone === "red"
        ? "text-[var(--color-laque-bright)]"
        : "text-[var(--color-ivoire)]";
  return (
    <div
      className="relative border border-[var(--color-or)]/15 bg-[var(--color-noir-soft)] px-4 py-3.5 overflow-hidden"
      style={{
        boxShadow:
          "inset 0 1px 0 color-mix(in oklab, var(--color-or) 7%, transparent)",
      }}
    >
      <p className="label-mono text-[var(--color-ivoire-soft)]/70">{label}</p>
      <p className={`figural text-3xl mt-1.5 leading-none ${toneCls}`}>
        {numeric ? <CountUp value={value} /> : value}
      </p>
      {sub ? (
        <p className="text-[10px] tracking-wide text-[var(--color-ivoire-soft)]/70 mt-1.5">
          {sub}
        </p>
      ) : null}
    </div>
  );
}

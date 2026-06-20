import { STATUS_OPTIONS, STATUS_KANJI, statusAccent } from "./preorderConstants.js";

/**
 * Lifecycle filter rail — "all" plus one kanji chip per non-empty lifecycle
 * state. Each chip's kanji carries its lifecycle accent, turning the rail into
 * a living colour-key; the active chip picks up a soft accent ring + wash on
 * top of the .is-active gold styling.
 */
export default function PreorderFilterRail({ filter, onChange, counts, t }) {
  // Only show status chips that have at least one entry — keeps the rail tight.
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

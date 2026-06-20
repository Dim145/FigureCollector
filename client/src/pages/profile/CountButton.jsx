/**
 * Clickable social counter — opens the followers / following list modal.
 * Tabular figures keep the two counts vertically aligned; ≥44px tap target.
 */
export default function CountButton({ value, label, onClick }) {
  return (
    <button type="button" onClick={onClick} className="tap-target group text-left">
      <span className="figural tabular-nums text-2xl sm:text-3xl leading-none text-[var(--color-ivoire)] transition-colors group-hover:text-[var(--color-or-pale)]">
        {value}
      </span>
      <span className="micro-tight block mt-1">{label}</span>
    </button>
  );
}

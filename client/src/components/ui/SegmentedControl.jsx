/**
 * Compact mutually-exclusive switch (2–4 options) — e.g. view modes, search
 * modes. radiogroup semantics. `options`: [{ value, label, icon }].
 */
export default function SegmentedControl({
  options = [],
  value,
  onChange,
  size = "md",
  className = "",
  "aria-label": ariaLabel,
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`inline-flex p-0.5 border border-[var(--border)] bg-[var(--surface-sunken)] ${className}`}
      style={{ borderRadius: "var(--radius-pill)" }}
    >
      {options.map((o) => {
        const active = o.value === value;
        const Ic = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange?.(o.value)}
            className={`inline-flex items-center justify-center gap-1.5 ${
              size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-2 text-sm"
            } transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
              active
                ? "text-[var(--color-ivoire)]"
                : "text-[var(--on-surface-muted)] hover:text-[var(--on-surface)]"
            }`}
            style={{
              borderRadius: "var(--radius-pill)",
              background: active ? "var(--primary)" : "transparent",
            }}
          >
            {Ic ? <Ic size={15} strokeWidth={1.75} /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Underlined tab bar. Controlled: pass `value` + `onChange`. The caller renders
 * the matching panel (this is the tablist only). `tabs`: [{ value, label, icon,
 * count }].
 */
export default function Tabs({ tabs = [], value, onChange, className = "" }) {
  return (
    <div
      role="tablist"
      className={`flex items-center gap-1 overflow-x-auto border-b border-[var(--border-subtle)] ${className}`}
    >
      {tabs.map((t) => {
        const active = t.value === value;
        const Ic = t.icon;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(t.value)}
            className={`relative inline-flex items-center gap-2 px-4 py-3 text-sm whitespace-nowrap -mb-px transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
              active
                ? "text-[var(--on-surface)]"
                : "text-[var(--on-surface-muted)] hover:text-[var(--on-surface)]"
            }`}
          >
            {Ic ? <Ic size={16} strokeWidth={1.75} /> : null}
            {t.label}
            {t.count != null ? (
              <span className="text-[var(--on-surface-subtle)] text-xs">{t.count}</span>
            ) : null}
            {active ? (
              <span
                className="absolute left-2 right-2 bottom-0 h-px"
                style={{ background: "var(--primary)" }}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

import { useId } from "react";

/**
 * On/off switch (role=switch). Button-based so it carries aria-checked; the
 * optional label + hint are clickable too. Reduced-motion users still get the
 * colour change (only the thumb slide is motion).
 */
export default function Switch({
  checked = false,
  onChange,
  label,
  hint,
  disabled = false,
  id: idProp,
  className = "",
}) {
  const autoId = useId();
  const id = idProp || autoId;
  const toggle = () => {
    if (!disabled && onChange) onChange(!checked);
  };
  return (
    <div className={`flex items-center justify-between gap-4 ${className}`}>
      {label != null ? (
        <span className="min-w-0 cursor-pointer select-none" onClick={toggle}>
          <span className="block text-sm text-[var(--on-surface)]">{label}</span>
          {hint ? (
            <span className="block text-xs text-[var(--on-surface-muted)] mt-0.5">{hint}</span>
          ) : null}
        </span>
      ) : null}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={typeof label === "string" ? label : undefined}
        disabled={disabled}
        onClick={toggle}
        className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-[var(--dur-fast)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-raised)] disabled:opacity-50"
        style={{
          borderColor: checked ? "var(--primary)" : "var(--border-strong)",
          background: checked ? "var(--primary)" : "var(--surface-sunken)",
        }}
      >
        <span
          className="inline-block h-4 w-4 rounded-full transition-transform duration-[var(--dur-fast)]"
          style={{
            background: checked ? "var(--color-ivoire)" : "var(--on-surface-muted)",
            transform: checked ? "translateX(22px)" : "translateX(3px)",
          }}
        />
      </button>
    </div>
  );
}

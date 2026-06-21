import { useRef } from "react";

/**
 * Compact mutually-exclusive switch (2–4 options) — e.g. view modes, search
 * modes. radiogroup semantics. `options`: [{ value, label, icon }].
 *
 * WAI-ARIA radiogroup keyboard model: roving tabindex (only the checked radio
 * is focusable) + ArrowLeft/Right/Up/Down + Home/End move focus AND fire
 * onChange.
 */
export default function SegmentedControl({
  options = [],
  value,
  onChange,
  size = "md",
  className = "",
  "aria-label": ariaLabel,
}) {
  const refs = useRef([]);
  // Roving tabindex: the checked radio is the tab stop. When nothing is checked
  // yet (value matches no option), fall back to the first radio so the group
  // is still reachable by keyboard.
  const checkedIndex = options.findIndex((o) => o.value === value);
  const focusableIndex = checkedIndex === -1 ? 0 : checkedIndex;

  const focusAndSelect = (index) => {
    const opt = options[index];
    if (!opt) return;
    onChange?.(opt.value);
    refs.current[index]?.focus();
  };

  const onKeyDown = (e) => {
    const count = options.length;
    if (count === 0) return;
    const current = options.findIndex((o) => o.value === value);
    const from = current === -1 ? 0 : current;
    let next = null;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (from + 1) % count;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (from - 1 + count) % count;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = count - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    focusAndSelect(next);
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={`inline-flex p-0.5 border border-[var(--border)] bg-[var(--surface-sunken)] ${className}`}
      style={{ borderRadius: "var(--radius-pill)" }}
    >
      {options.map((o, i) => {
        const active = o.value === value;
        const Ic = o.icon;
        return (
          <button
            key={o.value}
            ref={(node) => {
              refs.current[i] = node;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={i === focusableIndex ? 0 : -1}
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

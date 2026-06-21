import { useId, useRef } from "react";

/**
 * Underlined tab bar. Controlled: pass `value` + `onChange`. The caller renders
 * the matching panel (this is the tablist only). `tabs`: [{ value, label, icon,
 * count }].
 *
 * WAI-ARIA tabs keyboard model: roving tabindex (only the active tab is
 * focusable) + ArrowLeft/ArrowRight/Home/End move focus AND select. Each tab
 * carries a deterministic id (`${baseId}-tab-${value}`) and `aria-controls`
 * referencing a panel id (`${baseId}-panel-${value}`). The scheme is
 * deterministic per-instance so a caller rendering panels alongside this
 * tablist can label them with the matching id (a dangling reference is
 * harmless — AT just ignores it when no such panel exists yet).
 */
export default function Tabs({ tabs = [], value, onChange, className = "" }) {
  const baseId = useId();
  const refs = useRef([]);

  const tabId = (v) => `${baseId}-tab-${v}`;
  const panelId = (v) => `${baseId}-panel-${v}`;

  // Roving tabindex: the active tab is the tab stop. When value matches no tab,
  // fall back to the first so the tablist stays keyboard-reachable.
  const activeIndex = tabs.findIndex((t) => t.value === value);
  const focusableIndex = activeIndex === -1 ? 0 : activeIndex;

  const focusAndSelect = (index) => {
    const tab = tabs[index];
    if (!tab) return;
    onChange?.(tab.value);
    refs.current[index]?.focus();
  };

  const onKeyDown = (e) => {
    const count = tabs.length;
    if (count === 0) return;
    const current = tabs.findIndex((t) => t.value === value);
    const from = current === -1 ? 0 : current;
    let next = null;
    switch (e.key) {
      case "ArrowRight":
        next = (from + 1) % count;
        break;
      case "ArrowLeft":
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
      role="tablist"
      onKeyDown={onKeyDown}
      className={`flex items-center gap-1 overflow-x-auto border-b border-[var(--border-subtle)] ${className}`}
    >
      {tabs.map((t, i) => {
        const active = t.value === value;
        const Ic = t.icon;
        return (
          <button
            key={t.value}
            ref={(node) => {
              refs.current[i] = node;
            }}
            type="button"
            role="tab"
            id={tabId(t.value)}
            aria-selected={active}
            aria-controls={panelId(t.value)}
            tabIndex={i === focusableIndex ? 0 : -1}
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

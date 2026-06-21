import { X } from "lucide-react";
import { useT } from "../../i18n/index.jsx";

/**
 * Tag / filter chip. Three modes:
 *   - static label (no handlers)
 *   - selectable (pass onClick + selected) → renders a button with aria-pressed
 *   - removable (pass onRemove) → adds an × button
 */
export default function Chip({
  children,
  selected = false,
  onClick,
  onRemove,
  disabled = false,
  className = "",
  ...props
}) {
  const t = useT();
  const interactive = !!onClick && !onRemove;
  const Comp = interactive ? "button" : "span";
  return (
    <Comp
      type={interactive ? "button" : undefined}
      onClick={interactive ? onClick : undefined}
      disabled={interactive ? disabled : undefined}
      aria-pressed={interactive ? selected : undefined}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs tracking-wide border transition-colors ${
        interactive
          ? "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          : ""
      } ${className}`}
      style={{
        borderRadius: "var(--radius-pill)",
        borderColor: selected ? "var(--accent)" : "var(--border)",
        background: selected
          ? "color-mix(in oklab, var(--accent) 12%, transparent)"
          : "var(--surface-sunken)",
        color: selected ? "var(--accent)" : "var(--on-surface-muted)",
      }}
      {...props}
    >
      {children}
      {onRemove ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={t("common.remove", { default: "Retirer" })}
          className="ml-0.5 -mr-1 opacity-70 hover:opacity-100 transition-opacity"
        >
          <X size={12} />
        </button>
      ) : null}
    </Comp>
  );
}

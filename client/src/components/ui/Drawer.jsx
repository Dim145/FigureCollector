import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useFocusTrap } from "../../hooks/useFocusTrap.js";
import { useScrollLock } from "../../hooks/useScrollLock.js";
import { useT } from "../../i18n/index.jsx";

const SIDES = {
  right: {
    justify: "justify-end",
    panel: "h-full w-full max-w-md fc-anim-sheet-right border-l",
    round: {},
  },
  left: {
    justify: "justify-start",
    panel: "h-full w-full max-w-md fc-anim-sheet-left border-r",
    round: {},
  },
  bottom: {
    justify: "items-end",
    panel: "w-full max-h-[85dvh] fc-anim-sheet-bottom border-t safe-bottom",
    round: { borderTopLeftRadius: "var(--radius-xl)", borderTopRightRadius: "var(--radius-xl)" },
  },
};

/**
 * Edge-anchored panel (filters, mobile nav, contextual forms). Same focus-trap
 * + scrim + scroll-lock contract as Modal. `side`: right | left | bottom.
 * Bottom sheets respect the safe-area inset.
 */
export default function Drawer({
  open,
  onClose,
  side = "right",
  title,
  children,
  footer,
  className = "",
}) {
  const t = useT();
  const ref = useRef(null);
  const titleId = useId();
  useFocusTrap(ref, { active: open, onClose });
  useScrollLock(open);

  if (!open) return null;
  const s = SIDES[side] ?? SIDES.right;

  return createPortal(
    <div
      className={`fixed inset-0 flex ${s.justify} fc-anim-scrim`}
      style={{ zIndex: "var(--z-drawer)", background: "var(--surface-overlay)" }}
      onClick={onClose}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        onClick={(e) => e.stopPropagation()}
        className={`relative flex flex-col bg-[var(--surface)] border-[var(--border)] ${s.panel} ${className}`}
        style={{ boxShadow: "var(--elevation-4)", ...s.round }}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--border-subtle)]">
          {title ? (
            <h2 id={titleId} className="display text-lg text-[var(--on-surface)]">
              {title}
            </h2>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close", { default: "Fermer" })}
            className="inline-flex items-center justify-center w-9 h-9 rounded-full text-[var(--on-surface-muted)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-sunken)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer ? (
          <div className="px-5 py-4 border-t border-[var(--border-subtle)]">{footer}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

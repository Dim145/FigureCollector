import { useId, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useFocusTrap } from "../../hooks/useFocusTrap.js";

const SIZES = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

/**
 * Base modal dialog. Generalises the ConfirmDialog pattern (createPortal +
 * useFocusTrap: focus enters on open, Tab cycles, Esc + backdrop close, focus
 * restored on close) into a reusable shell with optional title/description/
 * footer slots. Scrim + card animate in (reduced-motion safe). Body scroll is
 * locked while open.
 */
export default function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  closeOnBackdrop = true,
  hideClose = false,
  className = "",
}) {
  const ref = useRef(null);
  const titleId = useId();
  const descId = useId();
  useFocusTrap(ref, { active: open, onClose });

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-4 sm:p-6 fc-anim-scrim"
      style={{ zIndex: "var(--z-modal)", background: "var(--surface-overlay)" }}
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        onClick={(e) => e.stopPropagation()}
        className={`fc-anim-pop relative w-full ${SIZES[size] ?? SIZES.md} max-h-[calc(100dvh-2rem)] overflow-y-auto bg-[var(--surface)] border border-[var(--border)] ${className}`}
        style={{ borderRadius: "var(--radius-lg)", boxShadow: "var(--elevation-4)" }}
      >
        {!hideClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="absolute right-3 top-3 inline-flex items-center justify-center w-9 h-9 rounded-full text-[var(--on-surface-muted)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-sunken)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <X size={18} />
          </button>
        ) : null}
        {title || description ? (
          <div className="px-6 pt-6 pb-4">
            {title ? (
              <h2 id={titleId} className="display text-xl text-[var(--on-surface)] pr-8">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p id={descId} className="mt-2 text-sm text-[var(--on-surface-muted)]">
                {description}
              </p>
            ) : null}
          </div>
        ) : null}
        {children != null ? (
          <div className={title || description ? "px-6 pb-6" : "p-6"}>{children}</div>
        ) : null}
        {footer ? (
          <div className="px-6 py-4 border-t border-[var(--border-subtle)] flex items-center justify-end gap-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

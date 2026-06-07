import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { useT } from "../i18n/index.jsx";
import Button from "./Button.jsx";

/**
 * One confirmation dialog reused across the app. Replaces the scattered
 * `window.confirm()` calls (which can't be styled, can't be focus-trapped,
 * and break the keyboard contract the rest of the UI follows).
 *
 * Props
 *   open         : boolean
 *   title        : ReactNode — heading text
 *   body         : ReactNode (optional) — body copy
 *   confirmLabel : string (optional, default = t("editor.confirm") or "OK")
 *   cancelLabel  : string (optional, default = t("editor.cancel"))
 *   onConfirm    : () => void   — primary action
 *   onCancel     : () => void   — fires on Esc, backdrop click, and Cancel
 *   destructive  : boolean — paints the primary button laque-red
 *   busy         : boolean — disables the primary button while a mutation
 *                  is in flight
 *
 * Behaviour
 *   - Focus enters the dialog on open (auto-focused primary action).
 *   - Esc + backdrop click fire `onCancel`.
 *   - Focus is restored to the trigger element after close.
 */
export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  destructive = false,
  busy = false,
}) {
  const t = useT();
  const ref = useRef(null);
  const titleId = useId();
  const bodyId = useId();
  useFocusTrap(ref, { active: open, onClose: onCancel });

  if (!open) return null;

  return createPortal(
    <div role="dialog" aria-modal="true" onClick={onCancel} className="fig-pop">
      <div
        ref={ref}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="fig-pop-card"
        aria-labelledby={titleId}
        aria-describedby={body ? bodyId : undefined}
      >
        <h2 id={titleId} className="display text-xl text-[var(--color-ivoire)]">
          {title}
        </h2>
        {body ? (
          <p id={bodyId} className="mt-3 text-[var(--color-ivoire-soft)]">
            {body}
          </p>
        ) : null}
        <div className="flex items-center gap-3 justify-end mt-6">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel ?? t("editor.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={onConfirm}
            loading={busy}
            data-autofocus
            className={
              destructive
                ? "!bg-[var(--color-laque-bright)] hover:!bg-[var(--color-laque)] !text-[var(--color-ivoire)]"
                : undefined
            }
          >
            {confirmLabel ?? t("editor.confirm") ?? "OK"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

import { useEffect } from "react";

/**
 * Focus-trap helper for modal-style dialogs.
 *
 * When `active` is true:
 *   1. Moves focus into the container on mount/open. If a descendant
 *      carries `data-autofocus`, that element gets focus; otherwise the
 *      first tab-stop; otherwise the container itself.
 *   2. Tab + Shift-Tab cycle between first/last focusable descendants —
 *      keyboard users can't escape the dialog into the page underneath.
 *   3. Esc fires `onClose` (callers can ignore it by omitting the prop).
 *   4. On unmount, focus returns to whatever element held it before the
 *      dialog opened.
 *
 * Usage:
 *   const ref = useRef(null);
 *   useFocusTrap(ref, { active: open, onClose: () => setOpen(false) });
 *   return <div ref={ref} role="dialog" aria-modal="true">…</div>;
 *
 * The container must be focusable (give it tabIndex={-1}) so the fallback
 * "focus the container itself" works on modals with no focusable
 * descendants.
 */
export function useFocusTrap(containerRef, { active = true, onClose } = {}) {
  useEffect(() => {
    if (!active) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    const previouslyFocused =
      typeof document !== "undefined" ? document.activeElement : null;

    const focusableSelector = [
      "a[href]",
      "button:not([disabled])",
      "textarea:not([disabled])",
      "input:not([disabled]):not([type='hidden'])",
      "select:not([disabled])",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");

    const getFocusables = () =>
      Array.from(container.querySelectorAll(focusableSelector)).filter(
        // offsetParent === null catches display:none + visibility:hidden
        // (but NOT position:fixed; that's fine here, no modals nest).
        (el) => el.offsetParent !== null && !el.hasAttribute("inert"),
      );

    const focusFirst = () => {
      const auto = container.querySelector("[data-autofocus]");
      if (auto && typeof auto.focus === "function") {
        auto.focus({ preventScroll: true });
        return;
      }
      const els = getFocusables();
      if (els[0]) {
        els[0].focus({ preventScroll: true });
        return;
      }
      // Last resort: the container itself (caller must add tabIndex=-1).
      if (typeof container.focus === "function") {
        container.focus({ preventScroll: true });
      }
    };
    focusFirst();

    const onKey = (e) => {
      if (e.key === "Escape" && onClose) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const els = getFocusables();
      if (els.length === 0) {
        e.preventDefault();
        return;
      }
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    };
    container.addEventListener("keydown", onKey);
    return () => {
      container.removeEventListener("keydown", onKey);
      if (
        previouslyFocused &&
        typeof previouslyFocused.focus === "function" &&
        document.contains(previouslyFocused)
      ) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [active, containerRef, onClose]);
}

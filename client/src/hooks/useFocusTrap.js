import { useEffect, useRef } from "react";

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
 * Focus is placed once per open, not once per render: a dialog containing a
 * text field must not reclaim focus between keystrokes.
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
  // Every caller passes an inline arrow, so `onClose` is a new function on
  // each parent render. Depending on its identity would tear this effect down
  // and set it up again on every keystroke in a field inside the dialog —
  // re-running `focusFirst()` and stealing focus to the first tab stop (the
  // close button) between characters. The ref keeps the Esc handler pointed at
  // the latest callback while the effect stays tied to `active` alone.
  const onCloseRef = useRef(onClose);
  // Synced in its own effect rather than during render — a ref written while
  // rendering is a React-rules violation, and this one only has to be current
  // by the time a key is actually pressed.
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

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
      if (e.key === "Escape" && onCloseRef.current) {
        e.stopPropagation();
        onCloseRef.current();
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
  }, [active, containerRef]);
}

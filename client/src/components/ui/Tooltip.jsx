/* eslint-disable react-hooks/refs -- floating-ui's refs.setReference/setFloating
   are stable setter callbacks (the documented API), not render-time `.current`
   reads; the react-hooks/refs heuristic misfires on them. */
import { useState, cloneElement, isValidElement } from "react";
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  useHover,
  useFocus,
  useDismiss,
  useRole,
  useInteractions,
  FloatingPortal,
} from "@floating-ui/react";

/**
 * Hover/focus tooltip. Wrap a single focusable element (it's cloned to receive
 * the reference ref + interaction props). Shows on focus too (keyboard). Never
 * put essential-only info here — it's supplementary.
 *   <Tooltip label="Supprimer"><IconButton icon={Trash2} label="Supprimer" /></Tooltip>
 */
export default function Tooltip({ label, children, placement = "top", delay = 250 }) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    // Position via top/left so entrance keyframes that touch `transform` can't
    // clobber floating-ui's positioning (see DropdownMenu).
    transform: false,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const hover = useHover(context, { move: false, delay: { open: delay, close: 80 } });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "tooltip" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);

  if (!label || !isValidElement(children)) return children ?? null;

  return (
    <>
      {cloneElement(children, {
        ref: refs.setReference,
        ...getReferenceProps(children.props),
      })}
      {open ? (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={{
              ...floatingStyles,
              zIndex: "var(--z-popover)",
              borderRadius: "var(--radius-sm)",
              boxShadow: "var(--elevation-3)",
            }}
            {...getFloatingProps()}
            className="fc-anim-scrim px-2.5 py-1.5 text-xs text-[var(--on-surface)] bg-[var(--surface)] border border-[var(--border)] max-w-xs"
          >
            {label}
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}

/* eslint-disable react-hooks/refs -- floating-ui's refs.setReference/setFloating
   are stable setter callbacks (the documented API), not render-time `.current`
   reads; the react-hooks/refs heuristic misfires on them. */
import { useState, useRef, cloneElement, isValidElement } from "react";
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  useClick,
  useDismiss,
  useRole,
  useListNavigation,
  useInteractions,
  FloatingPortal,
  FloatingFocusManager,
} from "@floating-ui/react";

/**
 * Accessible dropdown / overflow menu (role=menu, roving focus, type-to-close
 * on Esc, click-outside dismiss). Replaces the hand-rolled UserMenu / bulk
 * action popovers.
 *
 *   <DropdownMenu
 *     trigger={<IconButton icon={MoreHorizontal} label="Plus" />}
 *     items={[
 *       { key: "edit", label: "Éditer", icon: Pencil, onSelect: () => {} },
 *       { separator: true },
 *       { key: "del", label: "Supprimer", icon: Trash2, danger: true, onSelect },
 *     ]}
 *   />
 */
export default function DropdownMenu({
  trigger,
  items = [],
  align = "end",
  "aria-label": ariaLabel,
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(null);
  const listRef = useRef([]);
  const placement =
    align === "start" ? "bottom-start" : align === "center" ? "bottom" : "bottom-end";

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    // Position via top/left (not a CSS transform). Our `.fc-anim-pop` entrance
    // keyframes animate `transform`, which would otherwise clobber floating-ui's
    // translate() and drop the menu to the viewport origin.
    transform: false,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "menu" });
  const listNav = useListNavigation(context, {
    listRef,
    activeIndex,
    onNavigate: setActiveIndex,
    loop: true,
  });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    click,
    dismiss,
    role,
    listNav,
  ]);

  if (!isValidElement(trigger)) return null;

  return (
    <>
      {cloneElement(trigger, {
        ref: refs.setReference,
        ...getReferenceProps(trigger.props),
      })}
      {open ? (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div
              ref={refs.setFloating}
              aria-label={ariaLabel}
              style={{
                ...floatingStyles,
                zIndex: "var(--z-popover)",
                borderRadius: "var(--radius-md)",
                boxShadow: "var(--elevation-4)",
              }}
              {...getFloatingProps()}
              className="fc-anim-pop min-w-48 py-1.5 bg-[var(--surface)] border border-[var(--border)]"
            >
              {items.map((it, i) => {
                if (it.separator) {
                  return (
                    <div
                      key={`sep-${i}`}
                      role="separator"
                      className="my-1.5 h-px bg-[var(--border-subtle)]"
                    />
                  );
                }
                // index among actionable (non-separator) items → roving focus
                const idx = items.slice(0, i).filter((x) => !x.separator).length;
                const Ic = it.icon;
                return (
                  <button
                    key={it.key ?? i}
                    type="button"
                    role="menuitem"
                    ref={(node) => {
                      listRef.current[idx] = node;
                    }}
                    disabled={it.disabled}
                    tabIndex={activeIndex === idx ? 0 : -1}
                    {...getItemProps({
                      onClick() {
                        if (it.disabled) return;
                        it.onSelect?.();
                        setOpen(false);
                      },
                    })}
                    className={`w-full flex items-center gap-3 px-3.5 py-2 text-sm text-left transition-colors outline-none disabled:opacity-50 hover:bg-[var(--surface-sunken)] ${
                      it.danger ? "text-[var(--danger)]" : "text-[var(--on-surface)]"
                    } ${activeIndex === idx ? "bg-[var(--surface-sunken)]" : ""}`}
                  >
                    {Ic ? (
                      <Ic size={16} strokeWidth={1.75} className="shrink-0 opacity-80" />
                    ) : null}
                    <span className="flex-1 truncate">{it.label}</span>
                  </button>
                );
              })}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      ) : null}
    </>
  );
}

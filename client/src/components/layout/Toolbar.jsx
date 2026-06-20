/**
 * Responsive action/filter bar. `start` (search + filters) flexes and wraps;
 * `end` (CTAs) stays grouped. `sticky` docks it under the page header on scroll
 * (uses the sticky z-index + a solid backdrop so content scrolls under it).
 */
export default function Toolbar({ start, end, sticky = false, className = "" }) {
  return (
    <div
      className={`flex items-center gap-3 flex-wrap ${sticky ? "sticky py-3" : ""} ${className}`}
      style={
        sticky
          ? { top: 0, zIndex: "var(--z-sticky)", background: "var(--surface-raised)" }
          : undefined
      }
    >
      {start ? (
        <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">{start}</div>
      ) : null}
      {end ? <div className="flex items-center gap-2 flex-wrap shrink-0">{end}</div> : null}
    </div>
  );
}

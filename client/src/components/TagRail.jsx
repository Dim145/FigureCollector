import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n/index.jsx";

// Horizontal gap between chips, in px. Must match the `gap-2` on the rows
// below so the off-screen measurement matches what the visible row renders.
const GAP = 8;

/**
 * One-line tag rail.
 *
 * Renders as many chips as fit on a *single* line at the current width and
 * folds the overflow behind a "+N" toggle; clicking it expands the rail in
 * place (wrapping to as many lines as needed) with a "Réduire" toggle to fold
 * it back. Re-measures on resize so the line always stays full but never wraps
 * while collapsed.
 *
 * The fit is measured on an off-screen mirror of *all* the chips (plus a
 * reserve toggle), laid out at the real width with `flex-wrap`, so a chip's
 * `offsetTop` reveals exactly where the first line breaks. The mirror is
 * `inert` + `aria-hidden`, so its duplicate chips never reach the tab order or
 * the a11y tree. Items are assumed pre-sorted by relevance by the caller
 * (catalogue facets come count-first; a figure's tags come tagger-confidence
 * first), so truncating the tail drops the least-relevant chips.
 *
 * @param {Array}    items       data, already ordered by relevance
 * @param {Function} renderChip  (item, index) => node — one chip (inline-flex)
 * @param {Function} keyOf       (item, index) => React key
 * @param {string}   [ariaLabel] label for the visible row
 */
export default function TagRail({ items, renderChip, keyOf, ariaLabel }) {
  const t = useT();
  const wrapRef = useRef(null);
  const measureRef = useRef(null);
  const [visible, setVisible] = useState(items.length);
  const [expanded, setExpanded] = useState(false);

  // Stable signature so the measuring effect only re-runs when the actual tag
  // set changes — not on every parent re-render (the arrays are often fresh).
  const signature = useMemo(
    () => items.map((it, i) => keyOf(it, i)).join(""),
    [items, keyOf],
  );

  useLayoutEffect(() => {
    const layer = measureRef.current;
    const wrap = wrapRef.current;
    if (!layer || !wrap) return;
    layer.inert = true; // belt-and-suspenders: keep the mirror out of tab/a11y
    const compute = () => {
      const chips = [...layer.querySelectorAll("[data-rail-chip]")];
      const toggle = layer.querySelector("[data-rail-toggle]");
      if (chips.length === 0) {
        setVisible(0);
        return;
      }
      // Collapsed, the rail clips to one line — so we only ever need to know
      // how many chips share the first line, then trim enough for the toggle.
      const top0 = chips[0].offsetTop;
      let line1 = 0;
      for (const c of chips) {
        if (c.offsetTop <= top0 + 2) line1++;
        else break;
      }
      if (line1 >= chips.length) {
        setVisible(chips.length); // everything already fits → no toggle
        return;
      }
      const avail = layer.clientWidth;
      const reserve = (toggle ? toggle.offsetWidth : 0) + GAP;
      let count = line1;
      while (count > 1) {
        const c = chips[count - 1];
        if (c.offsetLeft + c.offsetWidth + reserve <= avail) break;
        count--;
      }
      setVisible(Math.max(1, count));
    };
    compute();
    // Observe the real-size wrapper, NOT the zero-height absolute mirror — a
    // 0-height box doesn't reliably report width-only changes to a
    // ResizeObserver, so the rail wouldn't recompute on resize.
    const ro = new ResizeObserver(compute);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [signature]);

  const hidden = Math.max(0, items.length - visible);
  const collapsible = hidden > 0;
  const shown = expanded ? items : items.slice(0, visible);

  return (
    <div ref={wrapRef} className="relative">
      {/* Off-screen measurement mirror: every chip + a reserve toggle, full
          width, allowed to wrap so offsetTop exposes the first line break.
          Invisible and zero-height → no layout impact; inert → no a11y impact. */}
      <div
        ref={measureRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute inset-x-0 top-0 flex flex-wrap gap-2 overflow-hidden"
        style={{ height: 0 }}
      >
        {items.map((it, i) => (
          <span data-rail-chip key={keyOf(it, i)}>
            {renderChip(it, i)}
          </span>
        ))}
        <span data-rail-toggle>
          <RailToggle expanded={false} hidden={items.length} t={t} tabIndex={-1} />
        </span>
      </div>

      {/* Visible row — nowrap+clip while collapsed (guards against a 1px
          spillover wrapping to a 2nd line), wrap when expanded. */}
      <div
        className={`flex items-center gap-2 ${
          expanded ? "flex-wrap" : "flex-nowrap overflow-hidden"
        }`}
        aria-label={ariaLabel}
      >
        {shown.map((it, i) => (
          <span key={keyOf(it, i)} className="shrink-0">
            {renderChip(it, i)}
          </span>
        ))}
        {collapsible ? (
          <RailToggle
            expanded={expanded}
            hidden={hidden}
            t={t}
            onClick={() => setExpanded((e) => !e)}
          />
        ) : null}
      </div>
    </div>
  );
}

/** The fold/unfold pill. Collapsed shows "+N"; expanded shows "Réduire". The
 *  caret flips. Width is stable enough that the reserve copy (rendered with the
 *  max count) over-reserves by at most a couple px. */
function RailToggle({ expanded, hidden, t, onClick, tabIndex }) {
  return (
    <button
      type="button"
      onClick={onClick}
      tabIndex={tabIndex}
      aria-expanded={expanded}
      className="shrink-0 inline-flex items-center gap-1 whitespace-nowrap border border-[var(--color-or)]/20 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-[var(--color-or-pale)]/75 transition-colors hover:border-[var(--color-or)]/55 hover:text-[var(--color-or)]"
    >
      {expanded ? t("tags.less", { default: "Réduire" }) : `+${hidden}`}
      <span
        aria-hidden
        className={`text-[8px] leading-none transition-transform ${expanded ? "rotate-180" : ""}`}
      >
        ▾
      </span>
    </button>
  );
}

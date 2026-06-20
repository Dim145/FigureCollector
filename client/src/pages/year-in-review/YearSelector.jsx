import { SegmentedControl, Select } from "../../components/ui/index.js";

/**
 * Year switcher for the retrospective. Deep-links every choice through
 * `onSelect(year)` (the orchestrator navigates to /insights/year/:year), so
 * the URL is always the source of truth and the page is shareable.
 *
 * Up to 5 years render as a `SegmentedControl` (one tap, no menu); more years
 * collapse to a compact `Select` so the toolbar never overflows. The current
 * year is always present even with no data, so the user can always reach
 * "this year".
 *
 * @param {number[]} years   Descending list of selectable years.
 * @param {number}   current Active year.
 * @param {(y:number)=>void} onSelect
 * @param {string}   label   Accessible name for the control.
 */
export default function YearSelector({ years, current, onSelect, label }) {
  if (!years.length) return null;

  if (years.length <= 5) {
    return (
      <SegmentedControl
        aria-label={label}
        size="sm"
        value={current}
        onChange={(v) => onSelect(Number(v))}
        options={years.map((y) => ({ value: y, label: String(y) }))}
      />
    );
  }

  // >5 years: a compact native Select. It renders a real <label>, so the
  // control keeps an accessible name (Select does not forward aria-label).
  return (
    <Select
      label={label}
      value={String(current)}
      onChange={(v) => onSelect(Number(v))}
      options={years.map((y) => ({ value: String(y), label: String(y) }))}
      className="min-w-[8rem] [&_label]:sr-only"
    />
  );
}

import { Chip } from "../../components/ui/index.js";
import { typeKanji } from "../../lib/typeHue.js";

/**
 * Light, scannable type filter for a public collection grid. Renders one
 * selectable `Chip` per distinct figure type present (with its kanji glyph),
 * plus an "all" reset chip. Purely client-side — narrows the already-loaded
 * collection, no extra request. Hidden by the caller when there is only one
 * type (nothing to filter). Tabular count keeps the chips visually even.
 *
 * Props:
 *   - types: [{ type, count }] (caller-computed, in display order)
 *   - value: the active type id, or null for "all"
 *   - total: total piece count (for the "all" chip)
 *   - onChange(typeOrNull)
 *   - allLabel, typeLabel(id) → localized strings (caller passes `t`-bound fns)
 */
export default function TypeFilter({ types, value, total, onChange, allLabel, typeLabel }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={allLabel}>
      <Chip selected={value == null} onClick={() => onChange(null)}>
        {allLabel}
        <span className="tabular-nums opacity-60">{total}</span>
      </Chip>
      {types.map(({ type, count }) => (
        <Chip key={type} selected={value === type} onClick={() => onChange(type)}>
          <span className="ja not-italic leading-none" aria-hidden>
            {typeKanji(type)}
          </span>
          {typeLabel(type)}
          <span className="tabular-nums opacity-60">{count}</span>
        </Chip>
      ))}
    </div>
  );
}

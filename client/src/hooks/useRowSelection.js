import { useCallback, useMemo, useState } from "react";

/**
 * Lot 6 — multi-select state for the admin bulk-action tables.
 *
 * Tracks a Set of selected row ids and keeps it pruned to the ids currently
 * present (so a row that disappears after a refetch/filter can't linger in
 * the selection). Works for both uuid ids and the string slugs used by
 * figure-types.
 *
 *   const sel = useRowSelection(ids);
 *   sel.selectedIds          // array, pruned to `ids`
 *   sel.isSelected(id)       // bool
 *   sel.toggle(id)
 *   sel.toggleAll()          // select-all / clear-all over `ids`
 *   sel.clear()
 *   sel.allSelected          // every id selected (and ids non-empty)
 *   sel.someSelected         // ≥1 selected
 */
export function useRowSelection(ids) {
  const [selected, setSelected] = useState(() => new Set());

  // The live selection, intersected with the ids actually on screen.
  const selectedIds = useMemo(
    () => ids.filter((id) => selected.has(id)),
    [ids, selected],
  );

  const isSelected = useCallback((id) => selected.has(id), [selected]);

  const toggle = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const allSelected = ids.length > 0 && selectedIds.length === ids.length;

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const everySelected =
        ids.length > 0 && ids.every((id) => prev.has(id));
      return everySelected ? new Set() : new Set(ids);
    });
  }, [ids]);

  return {
    selectedIds,
    isSelected,
    toggle,
    toggleAll,
    clear,
    allSelected,
    someSelected: selectedIds.length > 0,
  };
}

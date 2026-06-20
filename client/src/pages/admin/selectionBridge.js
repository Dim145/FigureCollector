/**
 * Bridge the existing `useRowSelection` store (toggle-based API) to the shared
 * <DataTable/>'s controlled `selectedIds` / `onSelectionChange(nextIds)` pair.
 *
 * DataTable hands us the *full* next selection array (its select-all and
 * per-row toggles both produce one). `useRowSelection` only exposes per-id
 * `toggle`, so we reconcile by toggling exactly the ids whose membership
 * changed between the current selection and the requested next one — leaving
 * the hook untouched (it stays the single source of truth, pruned to on-screen
 * ids on its own).
 *
 * `allowed` (optional) restricts what may be selected — e.g. the Users page
 * excludes the current admin's own row from the selectable set (the server
 * refuses to delete the caller anyway). Ids outside `allowed` are dropped from
 * the incoming `next` before reconciling, so DataTable's "select all" can never
 * tick a forbidden row.
 *
 * When `allowed` is set, the header "select all" can never reach DataTable's
 * own all-selected state (a forbidden row is always visible-but-unselected), so
 * it would otherwise only ever *add*. To keep it a real toggle we treat a
 * select-all that produces no change (everything selectable is already on) as a
 * request to clear — matching the unconstrained DataTable behaviour.
 *
 *   onSelectionChange={selectionBridge(sel, allowedIdSet)}
 */
export function selectionBridge(sel, allowed) {
  return (next) => {
    const filtered = allowed ? next.filter((id) => allowed.has(id)) : next;
    const nextSet = new Set(filtered);
    const current = new Set(sel.selectedIds);

    const sameMembership =
      nextSet.size === current.size && [...nextSet].every((id) => current.has(id));
    // Header "select all" that changes nothing (all selectable already on) →
    // clear, so the header checkbox round-trips even with a forbidden row.
    if (allowed && sameMembership && nextSet.size > 0) {
      sel.clear();
      return;
    }

    // Toggle ids newly present…
    for (const id of nextSet) if (!current.has(id)) sel.toggle(id);
    // …and ids newly absent.
    for (const id of current) if (!nextSet.has(id)) sel.toggle(id);
  };
}

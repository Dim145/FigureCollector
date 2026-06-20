import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import Checkbox from "./Checkbox.jsx";

/**
 * Semantic, accessible data table for the admin/list screens.
 *
 *   columns: [{ key, header, sortable, align, width, render(row) }]
 *   rows, getRowId(row, i)
 *   sort: { key, dir: "asc"|"desc" }, onSort({ key, dir })
 *   selectable, selectedIds, onSelectionChange(ids)
 *   onRowClick(row), loading, empty (ReactNode shown when no rows), stickyHeader
 *
 * Header is sticky, sortable columns expose aria-sort, the whole table scrolls
 * horizontally inside its own well on narrow screens (page never side-scrolls).
 */
export default function DataTable({
  columns = [],
  rows = [],
  getRowId = (r, i) => r.id ?? i,
  sort,
  onSort,
  selectable = false,
  selectedIds = [],
  onSelectionChange,
  onRowClick,
  loading = false,
  empty,
  stickyHeader = true,
  className = "",
}) {
  const selected = new Set(selectedIds);
  const allSelected = rows.length > 0 && rows.every((r, i) => selected.has(getRowId(r, i)));
  const someSelected = rows.some((r, i) => selected.has(getRowId(r, i)));

  const toggleAll = () =>
    onSelectionChange?.(allSelected ? [] : rows.map((r, i) => getRowId(r, i)));
  const toggleRow = (id) =>
    onSelectionChange?.(
      selected.has(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id],
    );
  const handleSort = (col) => {
    if (!col.sortable || !onSort) return;
    const dir = sort?.key === col.key && sort?.dir === "asc" ? "desc" : "asc";
    onSort({ key: col.key, dir });
  };

  if (!loading && rows.length === 0 && empty != null) {
    return <div className={className}>{empty}</div>;
  }

  const colCount = columns.length + (selectable ? 1 : 0);

  return (
    <div className={`w-full overflow-x-auto ${className}`}>
      <table className="w-full border-collapse text-sm">
        <thead
          className={stickyHeader ? "sticky top-0 z-[1]" : ""}
          style={{ background: "var(--surface)" }}
        >
          <tr className="border-b border-[var(--border)]">
            {selectable ? (
              <th scope="col" className="w-10 px-3 py-3 text-left">
                <Checkbox
                  checked={allSelected}
                  indeterminate={!allSelected && someSelected}
                  onChange={toggleAll}
                />
              </th>
            ) : null}
            {columns.map((col) => {
              const sorted = sort?.key === col.key;
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={sorted ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                  className="px-3 py-3 micro text-[var(--on-surface-muted)] whitespace-nowrap"
                  style={{ width: col.width, textAlign: col.align ?? "left" }}
                >
                  {col.sortable && onSort ? (
                    <button
                      type="button"
                      onClick={() => handleSort(col)}
                      className="inline-flex items-center gap-1 hover:text-[var(--on-surface)] transition-colors"
                    >
                      {col.header}
                      {sorted ? (
                        sort.dir === "asc" ? (
                          <ChevronUp size={13} />
                        ) : (
                          <ChevronDown size={13} />
                        )
                      ) : (
                        <ChevronsUpDown size={13} className="opacity-40" />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-b border-[var(--border-subtle)]">
                  {Array.from({ length: colCount }).map((__, j) => (
                    <td key={j} className="px-3 py-3">
                      <span className="fc-skel block h-4 w-full max-w-[14ch]" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row, i) => {
                const id = getRowId(row, i);
                const isSel = selected.has(id);
                return (
                  <tr
                    key={id}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={`border-b border-[var(--border-subtle)] transition-colors ${
                      onRowClick ? "cursor-pointer" : ""
                    } ${isSel ? "bg-[var(--surface-sunken)]" : "hover:bg-[var(--surface-sunken)]"}`}
                  >
                    {selectable ? (
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={isSel} onChange={() => toggleRow(id)} />
                      </td>
                    ) : null}
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className="px-3 py-3 text-[var(--on-surface)] align-middle"
                        style={{ textAlign: col.align ?? "left" }}
                      >
                        {col.render ? col.render(row) : row[col.key]}
                      </td>
                    ))}
                  </tr>
                );
              })}
        </tbody>
      </table>
    </div>
  );
}

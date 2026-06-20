import { useMemo, useState } from "react";

/**
 * Client-side sort state + comparator wired to the shared <DataTable/>'s
 * `sort` / `onSort` contract ({ key, dir: "asc"|"desc" }).
 *
 * The admin list endpoints return the whole table at once, so sorting is done
 * in the browser. Pass an `accessors` map of `{ [columnKey]: (row) => value }`
 * for the sortable columns; values are compared with locale-aware string
 * compare for strings and numeric compare otherwise (numbers, timestamps).
 * Nullish values always sort last. Columns without an accessor aren't sortable.
 *
 *   const { sort, onSort, sortedRows } = useClientSort(rows, {
 *     name: (r) => r.name,
 *     created_at: (r) => new Date(r.created_at).getTime(),
 *   }, { key: "created_at", dir: "desc" });
 */
export function useClientSort(rows, accessors, initial = null) {
  const [sort, setSort] = useState(initial);

  const sortedRows = useMemo(() => {
    if (!sort || !accessors[sort.key]) return rows;
    const get = accessors[sort.key];
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      // Nullish always sinks to the bottom, regardless of direction.
      const na = va == null || va === "";
      const nb = vb == null || vb === "";
      if (na && nb) return 0;
      if (na) return 1;
      if (nb) return -1;
      if (typeof va === "string" || typeof vb === "string") {
        return String(va).localeCompare(String(vb)) * factor;
      }
      return (va - vb) * factor;
    });
  }, [rows, sort, accessors]);

  return { sort, onSort: setSort, sortedRows };
}

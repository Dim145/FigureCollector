import { useMemo, useState } from "react";

/**
 * Client-side pagination for the admin DataTables. The admin list endpoints
 * return the whole table (up to `limit=200/500`) in one query and sorting +
 * filtering happen in the browser, so paging is purely a *presentation* slice
 * here — it keeps a dense roster legible without a server round-trip. Page is
 * 1-indexed (matches the shared <Pagination/>).
 *
 *   const { page, setPage, pageCount, pageRows } = useClientPagination(rows, 20);
 *
 * `signature` (optional) is any value that should reset the cursor to page 1
 * when it changes (e.g. the active search query or tab). The cursor is also
 * clamped into range whenever the row count shrinks. Both are handled by
 * adjusting state *during render* (the React-recommended alternative to a
 * setState-in-effect), so there are no cascading-render effects.
 */
export function useClientPagination(rows, perPage = 20, signature) {
  const [rawPage, setPage] = useState(1);
  const [seenSig, setSeenSig] = useState(signature);

  const pageCount = Math.max(1, Math.ceil(rows.length / perPage));

  // Reset to page 1 when the upstream filter/tab signature changes — adjusted
  // during render so the slice below is already correct this pass.
  let page = rawPage;
  if (signature !== seenSig) {
    setSeenSig(signature);
    setPage(1);
    page = 1;
  }
  // Clamp the cursor back into range if the row count dropped (delete/filter).
  if (page > pageCount) page = pageCount;

  const pageRows = useMemo(() => {
    const start = (page - 1) * perPage;
    return rows.slice(start, start + perPage);
  }, [rows, page, perPage]);

  return { page, setPage, pageCount, pageRows };
}

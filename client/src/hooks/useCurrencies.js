import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { DISPLAY_CURRENCIES } from "../lib/money.js";

/**
 * The supported currency codes, fetched once from the server's
 * `GET /api/currencies` (the single source of truth — same list the backend
 * validates every money write-path against). Falls back to the bundled
 * `DISPLAY_CURRENCIES` until the request resolves, so currency pickers are
 * never momentarily empty.
 */
export function useCurrencies() {
  const q = useQuery({
    queryKey: ["currencies"],
    queryFn: () => api.get("/currencies"),
    staleTime: Infinity,
  });
  return Array.isArray(q.data) && q.data.length > 0 ? q.data : DISPLAY_CURRENCIES;
}

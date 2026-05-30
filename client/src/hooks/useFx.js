import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { getPref } from "../lib/userPrefs.js";

/** Currencies the SPA lets you display in (matches the figure-form set). */
export const FX_CURRENCIES = ["EUR", "USD", "GBP", "JPY", "CHF", "CAD"];

/**
 * Optional display-currency conversion preference + the rate table.
 *
 * Prefs are client-side (localStorage, like the bg-model pref) — a display
 * convenience, not collection truth. Convert is OFF by default; when on, the
 * rate table comes from the cached `/external/fx` proxy (ECB), and manual
 * overrides (also local) take precedence. Pair with `convertAmount` / the
 * `fxMultiplier` helper in lib/money.js.
 */
export function useFx() {
  const convert = getPref("fxConvert") === true;
  const display = (getPref("fxDisplay") || "EUR").toUpperCase();
  const overrides = getPref("fxOverrides") || {};

  const q = useQuery({
    queryKey: ["fx", display],
    queryFn: () => api.get(`/external/fx?base=${encodeURIComponent(display)}`),
    enabled: convert,
    staleTime: 6 * 3600_000,
    retry: false,
  });

  return {
    convert,
    display,
    overrides,
    rates: q.data?.rates ?? {},
    date: q.data?.date ?? null,
    loading: q.isLoading,
  };
}

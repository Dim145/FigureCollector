import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { useMe } from "../hooks/useMe.js";
import { getPref, setPref } from "../lib/userPrefs.js";

/**
 * One source of truth for how money is shown across the app.
 *
 *   display          — the user's `preferred_currency` (the single display
 *                      currency), or null when none is set.
 *   convertEnabled   — client toggle (localStorage), ON by default. Held in
 *                      state so flipping it in Settings re-renders every
 *                      <Money> at once, no reload.
 *   active           — convert + a display currency to convert into.
 *   ready            — active AND the rate table has loaded.
 *   rates / date     — EUR-anchored ECB table (units per 1 EUR) + its date.
 *
 * Native (unconverted) amounts are shown when there's no preferred currency or
 * the toggle is off — never a forced-EUR surprise. The original amount is
 * always preserved; <Money> shows it on hover.
 */
const Ctx = createContext({
  display: null,
  active: false,
  ready: false,
  rates: {},
  date: null,
  convertEnabled: true,
  setConvertEnabled: () => {},
});

export function DisplayCurrencyProvider({ children }) {
  const me = useMe();
  const display = me.data?.user?.preferred_currency || null;

  // Default ON: undefined (never toggled) → true; only an explicit `false` opts
  // out. Persisted to the same localStorage bag as the other client prefs.
  const [convertEnabled, setConvertEnabledState] = useState(
    () => getPref("fxConvert") !== false,
  );
  const setConvertEnabled = useCallback((v) => {
    setConvertEnabledState(v);
    setPref("fxConvert", v);
  }, []);

  const active = !!display && convertEnabled;

  // A single EUR-based table for the whole app — any C→D hop goes through EUR
  // (see lib/money toDisplay). Fetched once, cached 6h, only when conversion is
  // actually active.
  const q = useQuery({
    queryKey: ["fx", "EUR"],
    queryFn: () => api.get("/external/fx?base=EUR"),
    enabled: active,
    staleTime: 6 * 3600_000,
    retry: false,
  });

  const value = useMemo(
    () => ({
      display,
      active,
      ready: active && !!q.data,
      rates: q.data?.rates ?? {},
      date: q.data?.date ?? null,
      convertEnabled,
      setConvertEnabled,
    }),
    [display, active, q.data, convertEnabled, setConvertEnabled],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDisplayCurrency() {
  return useContext(Ctx);
}

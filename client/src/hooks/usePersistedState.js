import { useCallback, useEffect, useState } from "react";

/**
 * useState backed by localStorage. Same ergonomics as useState — returns
 * `[value, setValue]` and `setValue` accepts a value or an updater fn — but the
 * value survives a reload, scoped under `key`.
 *
 * Reads are lazy (initialiser runs once) and wrapped in try/catch so a disabled
 * / quota-exceeded / malformed-JSON store degrades to `defaultValue` instead of
 * throwing. Writes are best-effort and never crash the render.
 *
 *   const [hideNoop, setHideNoop] = usePersistedState("admin.tasks.hideNoop", false);
 */
export default function usePersistedState(key, defaultValue) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return defaultValue;
      return JSON.parse(raw);
    } catch {
      return defaultValue;
    }
  });

  // Persist on every value (or key) change. Best-effort: a disabled / full
  // store is swallowed so a write never crashes the render tree.
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* quota or disabled — ignore */
    }
  }, [key, value]);

  // Stable setter that mirrors React's updater-or-value contract.
  const set = useCallback((next) => {
    setValue((prev) => (typeof next === "function" ? next(prev) : next));
  }, []);

  return [value, set];
}

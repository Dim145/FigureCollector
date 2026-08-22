import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Mirror a screen's view state (query, sort, facets, density…) into the URL,
 * so a filtered view is shareable, bookmarkable, and survives a back-navigation
 * — the browser restores the URL, and the URL *is* the state.
 *
 * `defs` maps a state key to `{ default, param?, parse?, serialize? }`. It must
 * be **stable** (module scope or `useMemo`) — it keys the memo and the setter.
 *
 * Values equal to their default are removed from the URL, so an untouched
 * screen keeps a clean address. Writes use `replace` so typing in a search box
 * doesn't push 30 history entries for the Back button to chew through.
 *
 *   const DEFS = { q: { default: "" }, sort: { default: "recent" } };
 *   const [view, setView] = useUrlState(DEFS);
 *   setView({ q: "miku" });
 */
export default function useUrlState(defs) {
  const [sp, setSp] = useSearchParams();

  const value = useMemo(() => {
    const out = {};
    for (const [key, def] of Object.entries(defs)) {
      const raw = sp.get(def.param ?? key);
      if (raw == null) {
        out[key] = def.default;
      } else {
        out[key] = def.parse ? def.parse(raw) : raw;
      }
    }
    return out;
  }, [sp, defs]);

  const set = useCallback(
    (patch) => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, v] of Object.entries(patch)) {
            const def = defs[key];
            if (!def) continue;
            const name = def.param ?? key;
            const ser = def.serialize ? def.serialize(v) : v == null ? "" : String(v);
            const dflt = def.serialize
              ? def.serialize(def.default)
              : def.default == null
                ? ""
                : String(def.default);
            if (ser === "" || ser === dflt) next.delete(name);
            else next.set(name, ser);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSp, defs],
  );

  return [value, set];
}

/** Serialize/parse helpers for the common facet shapes. */
export const asBool = {
  parse: (raw) => raw === "1" || raw === "true",
  serialize: (v) => (v ? "1" : ""),
};
export const asSet = {
  parse: (raw) => new Set(raw.split(",").filter(Boolean)),
  serialize: (v) => (v && v.size ? [...v].join(",") : ""),
};

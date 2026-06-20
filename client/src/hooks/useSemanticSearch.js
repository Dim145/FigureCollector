import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

/**
 * Semantic ("Description") search. Embeds the query in-browser with e5-small
 * (lazy import → the ~MBs of model weights only download on first use) and hits
 * the text-search endpoint, which ranks the catalogue by cosine distance.
 *
 * Behaviour is identical to the inline effect it replaces:
 *   - runs only when `active` and there's a trimmed query;
 *   - `phase` drives the shared staged loader (model → local → server → results);
 *   - an AbortController makes a query change cancel the in-flight request
 *     rather than just discarding its result;
 *   - an empty query leaves the previous state untouched (the results view shows
 *     its own prompt via `hasQuery`).
 *
 * @param {object}  opts
 * @param {boolean} opts.active  whether semantic mode is the live search mode
 * @param {string}  opts.query  the (already-debounced) raw query text
 * @returns {{ results: Array|null, busy: boolean, error: boolean, phase: string|null }}
 */
export function useSemanticSearch({ active, query }) {
  const [state, setState] = useState({
    results: null,
    busy: false,
    error: false,
    phase: null,
  });

  useEffect(() => {
    if (!active) return undefined;
    const q = (query ?? "").trim();
    if (!q) return undefined;
    let cancelled = false;
    const ctrl = new AbortController();
    const setPhase = (phase) => {
      if (!cancelled) setState((s) => ({ ...s, phase }));
    };
    setState((s) => ({ ...s, busy: true, error: false, phase: null }));
    (async () => {
      try {
        const { embedText } = await import("../lib/embed.js");
        const embedding = await embedText(`query: ${q}`, setPhase);
        if (cancelled) return;
        setPhase("server");
        const results = await api.post(
          "/me/text-search",
          { embedding },
          { signal: ctrl.signal, onResponse: () => setPhase("results") },
        );
        if (!cancelled) setState({ results, busy: false, error: false, phase: null });
      } catch (e) {
        if (!cancelled && e?.name !== "AbortError")
          setState({ results: null, busy: false, error: true, phase: null });
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [active, query]);

  return state;
}

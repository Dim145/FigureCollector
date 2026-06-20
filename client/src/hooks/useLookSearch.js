import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

/**
 * "Apparence" (look) search. Embeds the description with the SigLIP text tower
 * in-browser (lazy import → ≈283 MB of weights only on first use) and hits the
 * clip-search endpoint, which matches the query against catalogue IMAGE
 * embeddings (text→image cross-modal retrieval).
 *
 * Same contract as {@link useSemanticSearch} — gated on `active` + a non-empty
 * query, staged `phase`, AbortController-cancelled on query change. Kept as its
 * own hook (rather than parameterising one) so the two ~hundreds-of-MB models
 * stay independently lazy and can fail independently.
 *
 * @param {object}  opts
 * @param {boolean} opts.active  whether look mode is the live search mode
 * @param {string}  opts.query  the (already-debounced) raw query text
 * @returns {{ results: Array|null, busy: boolean, error: boolean, phase: string|null }}
 */
export function useLookSearch({ active, query }) {
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
        const { embedClipText } = await import("../lib/embed.js");
        const embedding = await embedClipText(q, setPhase);
        if (cancelled) return;
        setPhase("server");
        const results = await api.post(
          "/me/clip-search",
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

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Resilient cover-image source with silent auto-recovery.
 *
 * Catalogue covers come either from third-party store CDNs (hotlinked
 * `official_image_url`) or from the same-origin `/api/figure-photos` proxy.
 * Under a burst of parallel loads either can fail transiently — a CDN
 * rate-limit, a DB-pool / object-store hiccup — and a plain <img> then stays
 * broken *silently* (no JS error fires) until the user manually reloads the
 * page, which only recovers a random subset at a time. That is the bug this
 * hook fixes.
 *
 * Given `{ primary, fallback }`, it returns an `src` plus an `onError` handler
 * that walks an attempt plan on each failure:
 *   primary → primary?fc_retry → fallback → fallback?fc_retry → null
 * The `?fc_retry` cache-buster dodges a cached error response (and the SW), and
 * a short backoff gives a transient rate-limit a moment to clear before the
 * retry. When the plan is exhausted `src` is null so the caller renders its
 * placeholder. State resets whenever the sources change (new card / new figure).
 */
export function useCoverImage({ primary, fallback } = {}) {
  // Attempt plan, computed synchronously so `src` is correct on first render
  // (no placeholder flash before an effect runs).
  const plan = useMemo(() => {
    const steps = [];
    for (const url of [primary, fallback]) {
      if (!url) continue;
      steps.push(url);
      steps.push(url + (url.includes("?") ? "&" : "?") + "fc_retry=1");
    }
    return steps;
  }, [primary, fallback]);

  const [step, setStep] = useState(0);
  const timerRef = useRef(null);

  // Reset to the first attempt when the candidate set changes; clear any
  // pending retry on unmount / change so it can't advance a stale card.
  useEffect(() => {
    setStep(0);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [plan]);

  const onError = () => {
    // Both <img> elements (blur backdrop + sharp foreground) share the src and
    // can fire onError together — coalesce into a single scheduled advance.
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setStep((s) => (s < plan.length ? s + 1 : s));
    }, 600);
  };

  // `plan[step]` is undefined once the plan is exhausted → expose null.
  return { src: plan[step] ?? null, onError };
}
